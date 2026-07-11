import * as vscode from 'vscode';
import { buildEditArgs, type DetailEditField } from './itemDetail';
import type { JoyClient } from './joyClient';
import { STATUSES, moveArgs } from './status';
import type {
  JoyItemStatus,
  JoyListResponse,
  JoyMilestone,
  JoyMilestoneListResponse,
  JoyShowResponse,
} from './types';

type DetailMessage =
  | { type: 'setStatus'; id: string; current: JoyItemStatus; target: JoyItemStatus }
  | { type: 'edit'; id: string; field: DetailEditField; value: string }
  | { type: 'comment'; id: string; text: string }
  | { type: 'assign'; id: string; member: string }
  | { type: 'unassign'; id: string; member: string }
  | { type: 'depAdd'; id: string; dep: string }
  | { type: 'depRemove'; id: string; dep: string }
  | { type: 'delete'; id: string; title: string }
  | { type: 'refresh' };

interface ItemRef {
  id: string;
  title: string;
}

const EDIT_FIELDS: readonly DetailEditField[] = [
  'title',
  'type',
  'priority',
  'effort',
  'milestone',
  'parent',
  'description',
];

export class ItemDetailViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'joyItemDetail';

  private view: vscode.WebviewView | undefined;
  private currentId: string | undefined;
  private canDelete: boolean | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: JoyClient,
    private readonly onDataChanged: () => void,
    private readonly onError: (err: unknown) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = renderHtml(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((message: DetailMessage) => {
      void this.handleMessage(message);
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
    if (this.currentId) {
      void this.pushItem();
    }
  }

  async showItem(id: string): Promise<void> {
    this.currentId = id;
    if (this.view) {
      this.view.show(true);
      await this.pushItem();
    } else {
      await vscode.commands.executeCommand(`${ItemDetailViewProvider.viewId}.focus`);
    }
  }

  /** Re-load the current item, e.g. after an external .joy/ change. */
  async refreshCurrent(): Promise<void> {
    if (this.currentId && this.view) {
      await this.pushItem();
    }
  }

  private async pushItem(): Promise<void> {
    if (!this.view || !this.currentId) return;
    try {
      const [shown, milestones, members, items, canDelete] = await Promise.all([
        this.client.runJson<JoyShowResponse>(['show', this.currentId]),
        this.loadMilestones(),
        this.loadMembers(),
        this.loadItems(),
        this.loadCanDelete(),
      ]);
      await this.view.webview.postMessage({
        type: 'item',
        item: shown.data,
        milestones,
        members,
        items,
        statuses: STATUSES,
        canDelete,
      });
    } catch (err) {
      await this.view.webview.postMessage({
        type: 'loadError',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async loadMilestones(): Promise<JoyMilestone[]> {
    try {
      const response = await this.client.runJson<JoyMilestoneListResponse>(['milestone', 'ls']);
      return response.data.milestones;
    } catch {
      return [];
    }
  }

  private async loadMembers(): Promise<string[]> {
    try {
      const response = await this.client.runJson<{ data: Record<string, unknown> }>([
        'project',
        'member',
      ]);
      return Object.keys(response.data);
    } catch {
      return [];
    }
  }

  /** All items, id and title only, to label and pick dependencies. */
  private async loadItems(): Promise<ItemRef[]> {
    try {
      const response = await this.client.runJson<JoyListResponse>(['ls', '--all']);
      return response.data.items.map((item) => ({ id: item.id, title: item.title }));
    } catch {
      return [];
    }
  }

  /**
   * Whether the current user may delete items. `joy rm` enforces the `delete`
   * capability, which the "all" role grants. Cached: it does not change between
   * items.
   */
  private async loadCanDelete(): Promise<boolean> {
    if (this.canDelete !== undefined) return this.canDelete;
    try {
      const [status, project] = await Promise.all([
        this.client.runJsonAllowFailure<{ data: { member?: string } }>(['auth', 'status'], {
          noAuthRetry: true,
        }),
        this.client.runJson<{ data: { members?: Record<string, { capabilities?: unknown }> } }>([
          'project',
        ]),
      ]);
      const me = status.data.member;
      const caps = me ? project.data.members?.[me]?.capabilities : undefined;
      this.canDelete =
        caps === 'all' || (typeof caps === 'object' && caps !== null && 'delete' in caps);
    } catch {
      this.canDelete = false;
    }
    return this.canDelete;
  }

  /** Confirm with a VS Code modal, then `joy rm --force` and clear the view. */
  private async deleteItem(id: string, title: string): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      `Delete ${id} "${title}"? This permanently removes the item and cannot be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') return;
    try {
      await this.client.run(['rm', id, '--force']);
      if (this.currentId === id) {
        this.currentId = undefined;
        await this.view?.webview.postMessage({ type: 'cleared' });
      }
      this.onDataChanged();
    } catch (err) {
      this.onError(err);
    }
  }

  private async handleMessage(message: DetailMessage): Promise<void> {
    if (message.type === 'delete') {
      await this.deleteItem(message.id, message.title);
      return;
    }
    try {
      switch (message.type) {
        case 'setStatus': {
          const args = moveArgs(message.id, message.current, message.target);
          if (!args) return;
          await this.client.run(args);
          break;
        }
        case 'edit': {
          if (!EDIT_FIELDS.includes(message.field)) return;
          await this.client.run(buildEditArgs(message.id, message.field, message.value));
          break;
        }
        case 'comment': {
          const text = message.text.trim();
          if (text.length === 0) return;
          await this.client.run(['comment', message.id, text]);
          break;
        }
        case 'assign': {
          await this.client.run(['assign', message.id, message.member]);
          break;
        }
        case 'unassign': {
          await this.client.run(['assign', message.id, message.member, '--unassign']);
          break;
        }
        case 'depAdd': {
          await this.client.run(['deps', message.id, '--add', message.dep]);
          break;
        }
        case 'depRemove': {
          await this.client.run(['deps', message.id, '--rm', message.dep]);
          break;
        }
        case 'refresh': {
          await this.pushItem();
          return;
        }
      }
      this.onDataChanged();
    } catch (err) {
      this.onError(err);
    } finally {
      await this.pushItem();
    }
  }
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'detail.js'));
  const markdownUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'markdown.js'),
  );
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'detail.css'));
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri.toString()}" rel="stylesheet">
  <title>Joy Item</title>
</head>
<body>
  <div id="app" class="empty">Select an item in the Backlog view.</div>
  <script nonce="${nonce}" src="${markdownUri.toString()}"></script>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
