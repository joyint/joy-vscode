import * as vscode from 'vscode';
import { JoyClient } from './joyClient';

export function activate(context: vscode.ExtensionContext): void {
  const client = new JoyClient({
    resolveExecutable: () => {
      const configured = vscode.workspace.getConfiguration('joy').get<string>('executablePath');
      return configured && configured.trim().length > 0 ? configured.trim() : 'joy';
    },
    resolveCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('joy.hello', async () => {
      try {
        const result = await client.run(['--version']);
        vscode.window.showInformationMessage(`Joy CLI: ${result.stdout.trim()}`);
      } catch (err) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }),
  );
}

export function deactivate(): void {
  // intentionally empty
}
