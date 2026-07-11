import * as vscode from 'vscode';
import { findJoyIdMatches } from './joyLinks';
import type { JoyItem } from './types';

function openItemUri(id: string): vscode.Uri {
  return vscode.Uri.parse(`command:joy.openDetail?${encodeURIComponent(JSON.stringify([id]))}`);
}

type GetItems = () => Promise<readonly JoyItem[]>;

/** Turns Joy item ids in any text document into links that open the item detail view. */
export class JoyLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly getItems: GetItems) {}

  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const items = await this.getItems();
    return findJoyIdMatches(document.getText(), items).map((match) => {
      const range = new vscode.Range(
        document.positionAt(match.start),
        document.positionAt(match.end),
      );
      const link = new vscode.DocumentLink(range, openItemUri(match.id));
      link.tooltip = `Open Joy item ${match.id}`;
      return link;
    });
  }
}

/** Shows the item title and status when hovering a linked Joy id. */
export class JoyHoverProvider implements vscode.HoverProvider {
  constructor(private readonly getItems: GetItems) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const items = await this.getItems();
    const offset = document.offsetAt(position);
    const match = findJoyIdMatches(document.getText(), items).find(
      (candidate) => offset >= candidate.start && offset <= candidate.end,
    );
    if (!match) return undefined;
    const item = items.find((candidate) => candidate.id === match.id);
    if (!item) return undefined;

    // Metadata only; the document link itself provides the "Open Joy item"
    // action, so a second open link here would be redundant.
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${item.id}** — ${item.title}\n\n`);
    md.appendMarkdown(`${item.type} · ${item.status} · ${item.priority}`);
    const range = new vscode.Range(
      document.positionAt(match.start),
      document.positionAt(match.end),
    );
    return new vscode.Hover(md, range);
  }
}
