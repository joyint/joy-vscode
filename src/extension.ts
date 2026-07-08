import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { AuthService, type AuthState } from './auth';
import type { BacklogNode, ItemNode } from './backlog';
import { BacklogDragAndDropController } from './backlogDnd';
import { BacklogProvider } from './backlogProvider';
import { ItemDetailViewProvider } from './itemDetailView';
import { JoyClient, JoyError, JoySessionExpiredError } from './joyClient';
import { JoyResolver, buildCommonJoyPaths, type JoyResolution } from './joyResolver';

const execFileAsync = promisify(execFile);

const INSTALL_DOCS_URL = 'https://github.com/joyint/joy';
const SHELL_LOOKUP_TIMEOUT_MS = 3000;

type LifecycleAction = 'start' | 'submit' | 'close' | 'reopen';

export function activate(context: vscode.ExtensionContext): void {
  const minimumVersion = readMinimumVersion(context);

  let resolvedExecutable = 'joy';

  const client: JoyClient = new JoyClient({
    resolveExecutable: () => resolvedExecutable,
    resolveCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    onAuthRequired: (): Promise<boolean> => authService.promptAndAuthenticate(),
  });

  const authService: AuthService = new AuthService(client);

  const resolver = new JoyResolver({
    getConfiguredPath: () =>
      vscode.workspace.getConfiguration('joy').get<string>('executablePath') ?? undefined,
    minimumVersion,
    run: async (executable, args) => {
      const { stdout, stderr } = await execFileAsync(executable, args, { timeout: 5000 });
      return { stdout, stderr };
    },
    shellLookup,
    getCommonPaths: () =>
      buildCommonJoyPaths({ platform: process.platform, home: os.homedir(), env: process.env }),
    pathExists: async (candidate) => {
      try {
        await fs.access(candidate);
        return true;
      } catch {
        return false;
      }
    },
  });

  const provider = new BacklogProvider(client);
  const treeView = vscode.window.createTreeView('joyBacklog', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: new BacklogDragAndDropController(client, provider, reportError),
  });

  const detailProvider = new ItemDetailViewProvider(
    context.extensionUri,
    client,
    () => provider.refresh(),
    reportError,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ItemDetailViewProvider.viewId, detailProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.name = 'Joy';

  context.subscriptions.push(treeView, statusItem);

  let lastResolution: JoyResolution | undefined;

  const performResolve = async (): Promise<void> => {
    const resolution = await resolver.resolve();
    lastResolution = resolution;
    if (resolution.kind === 'ok') {
      resolvedExecutable = resolution.executable;
      await authService.refreshStatus();
    }
    updateStatusBar(statusItem, resolution, authService.currentState());
    provider.refresh();
  };

  const getLastResolution = (): JoyResolution | undefined => lastResolution;

  context.subscriptions.push(
    authService.onDidChangeState((state) => {
      updateStatusBar(statusItem, lastResolution, state);
    }),
  );

  registerCommands(context, client, provider, detailProvider, treeView, performResolve, getLastResolution, authService);
  registerWatcher(context, () => {
    provider.refresh();
    void detailProvider.refreshCurrent();
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('joy.executablePath')) {
        void performResolve();
      }
    }),
  );

  void performResolve();
}

export function deactivate(): void {
  // intentionally empty
}

function readMinimumVersion(context: vscode.ExtensionContext): string {
  const pkg = context.extension.packageJSON as { joyCli?: { minimumVersion?: string } };
  return pkg.joyCli?.minimumVersion ?? '0.0.0';
}

async function shellLookup(): Promise<string | undefined> {
  if (process.platform === 'win32') {
    return undefined;
  }
  const shell = process.env['SHELL']?.trim() || '/bin/bash';
  try {
    const { stdout } = await execFileAsync(shell, ['-lc', 'command -v joy 2>/dev/null'], {
      timeout: SHELL_LOOKUP_TIMEOUT_MS,
    });
    const path = stdout.trim();
    return path.length > 0 ? path : undefined;
  } catch {
    return undefined;
  }
}

function updateStatusBar(
  item: vscode.StatusBarItem,
  resolution: JoyResolution | undefined,
  auth: AuthState,
): void {
  const setMissing = resolution?.kind === 'missing';
  void vscode.commands.executeCommand('setContext', 'joy:cliMissing', setMissing);
  if (!resolution) return;

  if (resolution.kind === 'ok') {
    item.backgroundColor = undefined;
    const lines = [`**Joy** CLI ${resolution.version}`, `\`${resolution.executable}\``];
    if (auth.kind === 'authenticated') {
      item.text = '$(check) joy';
      const hours = auth.expiresInSeconds ? Math.round(auth.expiresInSeconds / 3600) : undefined;
      lines.push(`Authenticated as ${auth.member}${hours ? ` (${hours}h left)` : ''}`);
      item.command = 'joy.configureExecutablePath';
    } else if (auth.kind === 'unauthenticated') {
      item.text = '$(key) joy';
      lines.push(`Not authenticated (${auth.member}). Click to enter your passphrase.`);
      item.command = 'joy.authenticate';
    } else {
      item.text = '$(check) joy';
      item.command = 'joy.configureExecutablePath';
    }
    lines.push('[Configure path...](command:joy.configureExecutablePath)');
    const tooltip = new vscode.MarkdownString(lines.join('\n\n'));
    tooltip.isTrusted = true;
    item.tooltip = tooltip;
    item.show();
    return;
  }

  item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  if (resolution.kind === 'missing') {
    item.text = '$(warning) joy';
    item.tooltip = resolution.configured
      ? `Configured path "${resolution.configured}" did not resolve. Adjust joy.executablePath or install joy.`
      : 'joy was not found on PATH, via login shell, or in common install locations. Install joy or set joy.executablePath.';
    item.command = 'joy.openInstallDocs';
  } else if (resolution.kind === 'tooOld') {
    item.text = '$(warning) joy';
    item.tooltip = `Joy CLI ${resolution.version} is older than the required ${resolution.minimum}. Update joy.`;
    item.command = 'joy.openInstallDocs';
  } else {
    item.text = '$(error) joy';
    item.tooltip = resolution.error;
    item.command = undefined;
  }
  item.show();
}

function registerCommands(
  context: vscode.ExtensionContext,
  client: JoyClient,
  provider: BacklogProvider,
  detailProvider: ItemDetailViewProvider,
  treeView: vscode.TreeView<BacklogNode>,
  performResolve: () => Promise<void>,
  getLastResolution: () => JoyResolution | undefined,
  authService: AuthService,
): void {
  const sub = (command: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  sub('joy.authenticate', async () => {
    const authenticated = await authService.promptAndAuthenticate();
    if (authenticated) {
      vscode.window.showInformationMessage('Joy: authenticated.');
      provider.refresh();
    }
  });

  sub('joy.openInstallDocs', () => {
    void vscode.env.openExternal(vscode.Uri.parse(INSTALL_DOCS_URL));
  });

  sub('joy.configureExecutablePath', async () => {
    const config = vscode.workspace.getConfiguration('joy');
    const current = config.get<string>('executablePath') ?? '';
    const last = getLastResolution();
    const autoDetected = last?.kind === 'ok' ? last.executable : undefined;

    const input = await vscode.window.showInputBox({
      title: 'Joy: Configure CLI Path',
      prompt: 'Absolute path to the joy executable. Leave empty to auto-resolve.',
      value: current,
      placeHolder: autoDetected
        ? `${autoDetected} (auto-detected)`
        : 'Absolute path to the joy executable',
      ignoreFocusOut: true,
    });
    if (input === undefined) return;
    await config.update('executablePath', input.trim(), vscode.ConfigurationTarget.Global);
    await performResolve();
  });

  sub('joy.refresh', async () => {
    await performResolve();
  });

  sub('joy.openDetail', async (arg) => {
    const id = resolveItemId(arg, treeView);
    if (!id) {
      vscode.window.showWarningMessage('Joy: no item selected.');
      return;
    }
    try {
      await detailProvider.showItem(id);
    } catch (err) {
      reportError(err);
    }
  });

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
      const id = resolveItemId(arg, treeView);
      if (!id) {
        vscode.window.showWarningMessage(`Joy: no item selected to ${action}.`);
        return;
      }
      try {
        await client.run([action, id]);
        vscode.window.showInformationMessage(`Joy: ${action} ${id}`);
        provider.refresh();
      } catch (err) {
        reportError(err);
      }
    });
  }

  sub('joy.addItem', async () => {
    const typePick = await vscode.window.showQuickPick(
      ['task', 'story', 'bug', 'epic', 'rework', 'decision', 'idea'],
      { title: 'Joy: New Item', placeHolder: 'Item type' },
    );
    if (!typePick) return;
    const title = await vscode.window.showInputBox({
      title: 'Joy: New Item',
      prompt: `Title for the new ${typePick}`,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length === 0 ? 'Title must not be empty' : undefined),
    });
    if (!title) return;
    try {
      const result = await client.run(['add', typePick, title.trim()]);
      vscode.window.showInformationMessage(`Joy: ${result.stdout.trim().split('\n')[0]}`);
      provider.refresh();
    } catch (err) {
      reportError(err);
    }
  });

  sub('joy.addMilestone', async () => {
    const title = await vscode.window.showInputBox({
      title: 'Joy: New Milestone',
      prompt: 'Milestone title',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length === 0 ? 'Title must not be empty' : undefined),
    });
    if (!title) return;
    const date = await vscode.window.showInputBox({
      title: 'Joy: New Milestone',
      prompt: 'Target date (YYYY-MM-DD), leave empty for none',
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim().length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
          ? undefined
          : 'Use YYYY-MM-DD or leave empty',
    });
    if (date === undefined) return;
    const args = ['milestone', 'add', title.trim()];
    if (date.trim().length > 0) {
      args.push('--date', date.trim());
    }
    try {
      const result = await client.run(args);
      vscode.window.showInformationMessage(`Joy: ${result.stdout.trim().split('\n')[0]}`);
      provider.refresh();
    } catch (err) {
      reportError(err);
    }
  });
}

function registerWatcher(context: vscode.ExtensionContext, onChange: () => void): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/.joy/items/**');
  let debounce: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      debounce = undefined;
      onChange();
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

function resolveNode(arg: unknown, treeView: vscode.TreeView<BacklogNode>): ItemNode | undefined {
  if (isItemNode(arg)) {
    return arg;
  }
  const selected = treeView.selection[0];
  return selected && isItemNode(selected) ? selected : undefined;
}

function resolveItemId(arg: unknown, treeView: vscode.TreeView<BacklogNode>): string | undefined {
  if (typeof arg === 'string' && arg.length > 0) {
    return arg;
  }
  return resolveNode(arg, treeView)?.item.id;
}

function isItemNode(value: unknown): value is ItemNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ItemNode).kind === 'item' &&
    typeof (value as ItemNode).item?.id === 'string'
  );
}

function reportError(err: unknown): void {
  if (err instanceof JoySessionExpiredError) {
    vscode.window
      .showWarningMessage('Joy: authentication required.', 'Authenticate')
      .then((choice) => {
        if (choice === 'Authenticate') {
          void vscode.commands.executeCommand('joy.authenticate');
        }
      });
    return;
  }
  const message =
    err instanceof JoyError ? err.message : err instanceof Error ? err.message : String(err);
  vscode.window.showErrorMessage(`Joy: ${message}`);
}
