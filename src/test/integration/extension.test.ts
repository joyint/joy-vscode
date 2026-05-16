import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXPECTED_COMMANDS = [
  'joy.hello',
  'joy.refresh',
  'joy.show',
  'joy.start',
  'joy.submit',
  'joy.close',
  'joy.reopen',
] as const;

describe('extension activation', () => {
  before(async () => {
    const extension = vscode.extensions.getExtension('joyint.joy-vscode');
    assert.ok(extension, 'extension joyint.joy-vscode should be discoverable');
    await extension.activate();
  });

  for (const command of EXPECTED_COMMANDS) {
    it(`registers ${command}`, async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes(command), `${command} should be registered`);
    });
  }

  it('exposes the joy.executablePath setting', () => {
    const config = vscode.workspace.getConfiguration('joy');
    const inspected = config.inspect<string>('executablePath');
    assert.ok(inspected, 'joy.executablePath should be a known setting');
  });

  it('contributes the joyBacklog view', () => {
    const extension = vscode.extensions.getExtension('joyint.joy-vscode');
    assert.ok(extension);
    const views = (extension.packageJSON.contributes?.views?.joy ?? []) as Array<{
      id: string;
    }>;
    assert.ok(
      views.some((v) => v.id === 'joyBacklog'),
      'joyBacklog view should be contributed under the joy container',
    );
  });
});
