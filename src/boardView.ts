import * as vscode from 'vscode';
import type { JoyClient } from './joyClient';
import type { JoyListResponse } from './types';

type BoardMessage =
  | { type: 'move'; id: string; column: string }
  | { type: 'open'; id: string }
  | { type: 'refresh' };

/** CLI invocation per drop target column; id is inserted after the verb. */
const COLUMN_MOVES: Record<string, (id: string) => string[]> = {
  new: (id) => ['status', id, 'new'],
  open: (id) => ['approve', id],
  'in-progress': (id) => ['start', id],
  review: (id) => ['submit', id],
  closed: (id) => ['close', id],
  deferred: (id) => ['defer', id],
};

/** Singleton editor panel showing the status-column board. */
export class BoardPanel {
  private static current: BoardPanel | undefined;

  static show(
    extensionUri: vscode.Uri,
    client: JoyClient,
    onDataChanged: () => void,
    onError: (err: unknown) => void,
  ): BoardPanel {
    if (BoardPanel.current) {
      BoardPanel.current.panel.reveal();
      void BoardPanel.current.refresh();
      return BoardPanel.current;
    }
    BoardPanel.current = new BoardPanel(extensionUri, client, onDataChanged, onError);
    return BoardPanel.current;
  }

  /** Refresh the board if it is open; no-op otherwise. */
  static refreshIfOpen(): void {
    void BoardPanel.current?.refresh();
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    extensionUri: vscode.Uri,
    private readonly client: JoyClient,
    private readonly onDataChanged: () => void,
    private readonly onError: (err: unknown) => void,
  ) {
    this.panel = vscode.window.createWebviewPanel('joyBoard', 'Joy Board', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'resources', 'joy.svg');
    this.panel.webview.html = renderHtml(this.panel.webview, extensionUri);
    this.panel.webview.onDidReceiveMessage((message: BoardMessage) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      if (BoardPanel.current === this) {
        BoardPanel.current = undefined;
      }
    });
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const response = await this.client.runJson<JoyListResponse>(['ls', '--all']);
      await this.panel.webview.postMessage({ type: 'board', items: response.data.items });
    } catch (err) {
      await this.panel.webview.postMessage({
        type: 'loadError',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleMessage(message: BoardMessage): Promise<void> {
    switch (message.type) {
      case 'move': {
        const buildArgs = COLUMN_MOVES[message.column];
        if (!buildArgs) return;
        try {
          await this.client.run(buildArgs(message.id));
          this.onDataChanged();
        } catch (err) {
          this.onError(err);
        } finally {
          await this.refresh();
        }
        return;
      }
      case 'open': {
        await vscode.commands.executeCommand('joy.openDetail', message.id);
        return;
      }
      case 'refresh': {
        await this.refresh();
        return;
      }
    }
  }
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'board.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'board.css'));
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri.toString()}" rel="stylesheet">
  <title>Joy Board</title>
</head>
<body>
  <header id="toolbar">
    <input id="filter" type="text" placeholder="Filter by id or title..." spellcheck="false">
    <label for="sort">Sort</label>
    <select id="sort">
      <option value="updated" selected>updated</option>
      <option value="created">created</option>
      <option value="id">id</option>
      <option value="title">title</option>
      <option value="effort">effort</option>
      <option value="priority">priority</option>
      <option value="type">type</option>
    </select>
    <button id="direction" title="Toggle sort direction">desc</button>
  </header>
  <main id="board" class="empty">Loading...</main>
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
