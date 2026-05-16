import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import type { BacklogNode } from './backlog';
import { BacklogProvider } from './backlogProvider';
import { JoyClient, JoyError, JoySessionExpiredError } from './joyClient';
import { JoyResolver, buildCommonJoyPaths, type JoyResolution } from './joyResolver';

const execFileAsync = promisify(execFile);

const INSTALL_DOCS_URL = 'https://github.com/joyint/joy';
const SHELL_LOOKUP_TIMEOUT_MS = 3000;

type LifecycleAction = 'start' | 'submit' | 'close' | 'reopen';

export function activate(context: vscode.ExtensionContext): void {
  const minimumVersion = readMinimumVersion(context);

  let resolvedExecutable = 'joy';

  const client = new JoyClient({
    resolveExecutable: () => resolvedExecutable,
    resolveCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });

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
  });

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.name = 'Joy CLI';

  context.subscriptions.push(treeView, statusItem);

  let lastResolution: JoyResolution | undefined;

  const performResolve = async (): Promise<void> => {
    const resolution = await resolver.resolve();
    lastResolution = resolution;
    if (resolution.kind === 'ok') {
      resolvedExecutable = resolution.executable;
    }
    applyResolution(statusItem, resolution);
    provider.refresh();
  };

  const getLastResolution = (): JoyResolution | undefined => lastResolution;

  registerCommands(context, client, provider, treeView, performResolve, getLastResolution);
  registerWatcher(context, provider);

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

function applyResolution(item: vscode.StatusBarItem, resolution: JoyResolution): void {
  const setMissing = resolution.kind === 'missing';
  void vscode.commands.executeCommand('setContext', 'joy:cliMissing', setMissing);

  if (resolution.kind === 'ok') {
    item.text = `$(check) Joy CLI ${resolution.version}`;
    item.backgroundColor = undefined;
    const tooltip = new vscode.MarkdownString(
      `**Joy CLI ${resolution.version}**\n\n\`${resolution.executable}\`\n\n[Configure path...](command:joy.configureExecutablePath)`,
    );
    tooltip.isTrusted = true;
    item.tooltip = tooltip;
    item.command = 'joy.configureExecutablePath';
    item.show();
    return;
  }

  item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  if (resolution.kind === 'missing') {
    item.text = '$(warning) Joy CLI: not found';
    item.tooltip = resolution.configured
      ? `Configured path "${resolution.configured}" did not resolve. Adjust joy.executablePath or install joy.`
      : 'joy was not found on PATH, via login shell, or in common install locations. Install joy or set joy.executablePath.';
    item.command = 'joy.openInstallDocs';
  } else if (resolution.kind === 'tooOld') {
    item.text = `$(warning) Joy CLI: ${resolution.version} < ${resolution.minimum}`;
    item.tooltip = `Update joy to at least ${resolution.minimum}.`;
    item.command = 'joy.openInstallDocs';
  } else {
    item.text = '$(error) Joy CLI: unreadable';
    item.tooltip = resolution.error;
    item.command = undefined;
  }
  item.show();
}

function registerCommands(
  context: vscode.ExtensionContext,
  client: JoyClient,
  provider: BacklogProvider,
  treeView: vscode.TreeView<BacklogNode>,
  performResolve: () => Promise<void>,
  getLastResolution: () => JoyResolution | undefined,
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
