import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { AuthService, type AuthState } from './auth';
import type { BacklogNode, BacklogOrder, ItemNode } from './backlog';
import { BacklogDragAndDropController } from './backlogDnd';
import { BacklogProvider } from './backlogProvider';
import { BoardPanel } from './boardView';
import { ItemDetailViewProvider } from './itemDetailView';
import { JoyClient, JoyError, JoySessionExpiredError } from './joyClient';
import { JoyHoverProvider, JoyLinkProvider } from './joyLinkProvider';
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

  const backlogOrder = readBacklogOrder(context);
  void vscode.commands.executeCommand('setContext', 'joy:backlogOrder', backlogOrder);

  const provider = new BacklogProvider(client, backlogOrder);
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

  // Turn Joy item ids (ACRONYM-XXXX[-YY]) in any text document into links that
  // open the item detail view, with a hover showing the item's title/status.
  const linkSelector: vscode.DocumentSelector = [{ scheme: 'file' }, { scheme: 'untitled' }];
  const getItems = () => provider.ensureItems();
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(linkSelector, new JoyLinkProvider(getItems)),
    vscode.languages.registerHoverProvider(linkSelector, new JoyHoverProvider(getItems)),
  );

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
    BoardPanel.refreshIfOpen();
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('joy.openBoard', () => {
      BoardPanel.show(context.extensionUri, client, () => provider.refresh(), reportError);
    }),
  );

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

function readBacklogOrder(context: vscode.ExtensionContext): BacklogOrder {
  return context.workspaceState.get<BacklogOrder>('joy.backlogOrder') === 'old' ? 'old' : 'new';
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
      item.text = '$(check)$(unlock) joy';
      const hours = auth.expiresInSeconds ? Math.round(auth.expiresInSeconds / 3600) : undefined;
      lines.push(`Authenticated as ${auth.member}${hours ? ` (${hours}h left)` : ''}`);
      item.command = 'joy.configureExecutablePath';
    } else if (auth.kind === 'unauthenticated') {
      item.text = '$(check)$(lock) joy';
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

  sub('joy.initCopilot', async () => {
    // `joy ai init --tool copilot` writes .github/copilot-instructions.md (which
    // VS Code Copilot reads automatically), registers the ai:copilot@joy member,
    // and adds the gitignore entries. Registering the member is attested with
    // the operator passphrase, so prompt for it and feed it on stdin.
    const passphrase = await vscode.window.showInputBox({
      title: 'Joy: Set up Copilot Integration',
      prompt:
        'Enter your Joy passphrase to register the Copilot AI member and write .github/copilot-instructions.md.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.length === 0 ? 'Passphrase must not be empty.' : undefined),
    });
    if (passphrase === undefined) return;
    try {
      await client.run(['ai', 'init', '--tool', 'copilot', '--passphrase-stdin'], {
        stdin: `${passphrase}\n`,
        noAuthRetry: true,
      });
      await enableCopilotInstructionFiles();
      vscode.window.showInformationMessage(
        'Joy: Copilot integration set up. .github/copilot-instructions.md was written; reload the Copilot Chat window to pick it up.',
      );
      provider.refresh();
    } catch (err) {
      reportError(err);
    }
  });

  sub('joy.addDelegationToken', async () => {
    // The operator issues a delegation token for one of the AI members they
    // have delegated to (auth status -> delegated_sessions), then pastes it to
    // the AI, which redeems it with `joy auth --token <token> --json`.
    // Every AI member of the project. `joy auth token add` itself checks that
    // the current operator may issue a token for the chosen one (and creates the
    // delegation on first use), so no extra filtering is needed here.
    let members: string[];
    try {
      const project = await client.runJson<{ data: { members?: Record<string, unknown> } }>([
        'project',
      ]);
      members = Object.keys(project.data.members ?? {})
        .filter((id) => id.startsWith('ai:'))
        .sort();
    } catch (err) {
      reportError(err);
      return;
    }
    if (members.length === 0) {
      vscode.window.showWarningMessage(
        'Joy: no AI members in this project. Add one with "Joy: Init Copilot" or `joy project member add ai:<name>@joy`.',
      );
      return;
    }

    const member =
      members.length === 1
        ? members[0]
        : await vscode.window.showQuickPick(members, {
            title: 'Joy: Add AI Delegation Token',
            placeHolder: 'AI member to issue a delegation token for',
          });
    if (!member) return;

    const passphrase = await vscode.window.showInputBox({
      title: `Joy: Delegation Token for ${member}`,
      prompt: 'Enter your Joy passphrase to issue the token.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.length === 0 ? 'Passphrase must not be empty.' : undefined),
    });
    if (passphrase === undefined) return;

    try {
      const result = await client.runJson<{
        data: { token: string; member: string; ttl_hours: number };
      }>(['auth', 'token', 'add', member, '--passphrase-stdin'], {
        stdin: `${passphrase}\n`,
        noAuthRetry: true,
      });
      const { token, ttl_hours: ttl } = result.data;
      await vscode.env.clipboard.writeText(token);
      const choice = await vscode.window.showInformationMessage(
        `Joy: delegation token for ${member} copied to clipboard (valid ${ttl}h). The AI redeems it with: joy auth --token <token> --json`,
        'Copy redeem command',
      );
      if (choice === 'Copy redeem command') {
        await vscode.env.clipboard.writeText(`joy auth --token ${token} --json`);
        vscode.window.showInformationMessage('Joy: redeem command copied to clipboard.');
      }
    } catch (err) {
      reportError(err);
    }
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

  const applyBacklogOrder = async (order: BacklogOrder): Promise<void> => {
    provider.setOrder(order);
    await context.workspaceState.update('joy.backlogOrder', order);
    await vscode.commands.executeCommand('setContext', 'joy:backlogOrder', order);
  };
  sub('joy.sortOldest', () => applyBacklogOrder('old'));
  sub('joy.sortNewest', () => applyBacklogOrder('new'));

  sub('joy.clearParent', async (arg) => {
    const id = resolveItemId(arg, treeView);
    if (!id) {
      vscode.window.showWarningMessage('Joy: no item selected.');
      return;
    }
    try {
      await client.run(['edit', id, '--parent', 'none']);
      provider.refresh();
    } catch (err) {
      reportError(err);
    }
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

/**
 * Best-effort: make sure VS Code Copilot honours instruction files so it reads
 * the `.github/copilot-instructions.md` joy just wrote. A missing Copilot
 * extension leaves the setting unregistered; the write then no-ops and the file
 * is simply there for whenever Copilot is installed.
 */
async function enableCopilotInstructionFiles(): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('github.copilot.chat.codeGeneration');
    if (config.get<boolean>('useInstructionFiles') === false) {
      await config.update('useInstructionFiles', true, vscode.ConfigurationTarget.Workspace);
    }
  } catch {
    // Copilot not installed or the setting is unavailable; nothing to do.
  }
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
