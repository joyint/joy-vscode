import * as vscode from 'vscode';
import { buildEditArgs, type DetailEditField } from './itemDetail';
import type { JoyClient } from './joyClient';
import { STATUSES, moveArgs } from './status';
import type {
  JoyItemStatus,
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
  | { type: 'refresh' };

const EDIT_FIELDS: readonly DetailEditField[] = [
  'title',
  'type',
  'priority',
  'effort',
  'milestone',
  'description',
];

export class ItemDetailViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'joyItemDetail';

  private view: vscode.WebviewView | undefined;
  private currentId: string | undefined;

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
      const [shown, milestones, members] = await Promise.all([
        this.client.runJson<JoyShowResponse>(['show', this.currentId]),
        this.loadMilestones(),
        this.loadMembers(),
      ]);
      await this.view.webview.postMessage({
        type: 'item',
        item: shown.data,
        milestones,
        members,
        statuses: STATUSES,
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

  private async handleMessage(message: DetailMessage): Promise<void> {
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
