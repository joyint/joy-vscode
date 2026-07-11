import * as vscode from 'vscode';
import { findJoyIdMatches } from './joyLinks';
import type { JoyItem } from './types';

function openItemUri(id: string): vscode.Uri {
  return vscode.Uri.parse(`command:joy.openDetail?${encodeURIComponent(JSON.stringify([id]))}`);
}

/** Turns Joy item ids in any text document into links that open the item detail view. */
export class JoyLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly getItems: () => readonly JoyItem[]) {}

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    return findJoyIdMatches(document.getText(), this.getItems()).map((match) => {
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
  constructor(private readonly getItems: () => readonly JoyItem[]) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const items = this.getItems();
    const offset = document.offsetAt(position);
    const match = findJoyIdMatches(document.getText(), items).find(
      (candidate) => offset >= candidate.start && offset <= candidate.end,
    );
    if (!match) return undefined;
    const item = items.find((candidate) => candidate.id === match.id);
    if (!item) return undefined;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${item.id}** — ${item.title}\n\n`);
    md.appendMarkdown(`${item.type} · ${item.status} · ${item.priority}\n\n`);
    md.appendMarkdown(`[Open item](${openItemUri(item.id).toString()})`);
    md.isTrusted = true;
    const range = new vscode.Range(
      document.positionAt(match.start),
      document.positionAt(match.end),
    );
    return new vscode.Hover(md, range);
  }
}
