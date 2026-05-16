import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

describe('extension activation', () => {
  before(async () => {
    const extension = vscode.extensions.getExtension('joyint.joy-vscode');
    assert.ok(extension, 'extension joyint.joy-vscode should be discoverable');
    await extension.activate();
  });

  it('registers the joy.hello command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('joy.hello'), 'joy.hello command should be registered');
  });

  it('exposes the joy.executablePath setting', () => {
    const config = vscode.workspace.getConfiguration('joy');
    const inspected = config.inspect<string>('executablePath');
    assert.ok(inspected, 'joy.executablePath should be a known setting');
  });
});
