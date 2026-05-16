import * as vscode from 'vscode';
import type { BacklogNode } from './backlog';
import { BacklogProvider } from './backlogProvider';
import { JoyClient, JoyError, JoySessionExpiredError } from './joyClient';

type LifecycleAction = 'start' | 'submit' | 'close' | 'reopen';

export function activate(context: vscode.ExtensionContext): void {
  const client = new JoyClient({
    resolveExecutable: () => {
      const configured = vscode.workspace.getConfiguration('joy').get<string>('executablePath');
      return configured && configured.trim().length > 0 ? configured.trim() : 'joy';
    },
    resolveCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });

  const provider = new BacklogProvider(client);
  const treeView = vscode.window.createTreeView('joyBacklog', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(treeView);
  registerCommands(context, client, provider, treeView);
  registerWatcher(context, provider);
}

export function deactivate(): void {
  // intentionally empty
}

function registerCommands(
  context: vscode.ExtensionContext,
  client: JoyClient,
  provider: BacklogProvider,
  treeView: vscode.TreeView<BacklogNode>,
): void {
  const sub = (command: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  sub('joy.hello', async () => {
    try {
      const result = await client.run(['--version']);
      vscode.window.showInformationMessage(`Joy CLI: ${result.stdout.trim()}`);
    } catch (err) {
      reportError(err);
    }
  });

  sub('joy.refresh', () => provider.refresh());

  sub('joy.show', async (arg) => {
    const node = resolveNode(arg, treeView);
    if (!node) return;
    try {
      const result = await client.run(['show', node.item.id]);
      const doc = await vscode.workspace.openTextDocument({
        content: result.stdout,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err) {
      reportError(err);
    }
  });

  for (const action of ['start', 'submit', 'close', 'reopen'] as LifecycleAction[]) {
    sub(`joy.${action}`, async (arg) => {
      const node = resolveNode(arg, treeView);
      if (!node) {
        vscode.window.showWarningMessage(`Joy: select an item in the Backlog view to ${action}.`);
        return;
      }
      try {
        await client.run([action, node.item.id]);
        vscode.window.showInformationMessage(`Joy: ${action} ${node.item.id}`);
        provider.refresh();
      } catch (err) {
        reportError(err);
      }
    });
  }
}

function registerWatcher(context: vscode.ExtensionContext, provider: BacklogProvider): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/.joy/items/**');
  let debounce: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      debounce = undefined;
      provider.refresh();
    }, 250);
  };
  watcher.onDidCreate(schedule);
  watcher.onDidChange(schedule);
  watcher.onDidDelete(schedule);
  context.subscriptions.push(watcher, {
    dispose: () => {
      if (debounce) {
        clearTimeout(debounce);
      }
    },
  });
}

function resolveNode(
  arg: unknown,
  treeView: vscode.TreeView<BacklogNode>,
): BacklogNode | undefined {
  if (isBacklogNode(arg)) {
    return arg;
  }
  return treeView.selection[0];
}

function isBacklogNode(value: unknown): value is BacklogNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'item' in value &&
    'children' in value &&
    typeof (value as BacklogNode).item.id === 'string'
  );
}

function reportError(err: unknown): void {
  if (err instanceof JoySessionExpiredError) {
    vscode.window
      .showErrorMessage(
        'Joy session expired. Run "joy auth" in a terminal to re-authenticate.',
        'Open Terminal',
      )
      .then((choice) => {
        if (choice === 'Open Terminal') {
          const term = vscode.window.createTerminal('Joy');
          term.show();
          term.sendText('joy auth', false);
        }
      });
    return;
  }
  const message =
    err instanceof JoyError ? err.message : err instanceof Error ? err.message : String(err);
  vscode.window.showErrorMessage(`Joy: ${message}`);
}
