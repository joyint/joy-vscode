import * as vscode from 'vscode';
import { planDrop, type BacklogNode } from './backlog';
import type { BacklogProvider } from './backlogProvider';
import type { JoyClient } from './joyClient';

export const BACKLOG_MIME = 'application/vnd.code.tree.joybacklog';

/**
 * Drag and drop is structural only: re-parent, un-parent, or link to a
 * milestone. There is no manual ordering; sibling order stays computed.
 */
export class BacklogDragAndDropController implements vscode.TreeDragAndDropController<BacklogNode> {
  readonly dragMimeTypes = [BACKLOG_MIME];
  readonly dropMimeTypes = [BACKLOG_MIME];

  constructor(
    private readonly client: JoyClient,
    private readonly provider: BacklogProvider,
    private readonly onError: (err: unknown) => void,
  ) {}

  handleDrag(source: readonly BacklogNode[], dataTransfer: vscode.DataTransfer): void {
    const ids = source.filter((node) => node.kind === 'item').map((node) => node.item.id);
    if (ids.length > 0) {
      dataTransfer.set(BACKLOG_MIME, new vscode.DataTransferItem(JSON.stringify(ids)));
    }
  }

  async handleDrop(
    target: BacklogNode | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    const transferItem = dataTransfer.get(BACKLOG_MIME);
    if (!transferItem) return;
    let ids: string[];
    try {
      const raw: unknown = JSON.parse(await transferItem.asString());
      if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === 'string')) return;
      ids = raw;
    } catch {
      return;
    }

    const actions = planDrop(ids, target, this.provider.currentItems());
    if (actions.length === 0) return;

    try {
      for (const action of actions) {
        if (action.kind === 'reparent') {
          await this.client.run(['edit', action.id, '--parent', action.parent]);
        } else if (action.kind === 'clearParent') {
          await this.client.run(['edit', action.id, '--parent', 'none']);
        } else {
          await this.client.run(['milestone', 'link', action.id, action.milestone]);
        }
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.provider.refresh();
    }
  }
}
