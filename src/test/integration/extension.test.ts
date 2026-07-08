import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXPECTED_COMMANDS = [
  'joy.addItem',
  'joy.addMilestone',
  'joy.refresh',
  'joy.openDetail',
  'joy.show',
  'joy.start',
  'joy.submit',
  'joy.close',
  'joy.reopen',
  'joy.openInstallDocs',
  'joy.configureExecutablePath',
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

  it('contributes a welcome view gated on joy:cliMissing', () => {
    const extension = vscode.extensions.getExtension('joyint.joy-vscode');
    assert.ok(extension);
    const welcome = (extension.packageJSON.contributes?.viewsWelcome ?? []) as Array<{
      view: string;
      when: string;
    }>;
    const entry = welcome.find((w) => w.view === 'joyBacklog');
    assert.ok(entry, 'joyBacklog welcome view should be contributed');
    assert.ok(
      entry.when?.includes('joy:cliMissing'),
      'welcome view should be gated by joy:cliMissing',
    );
  });

  it('declares a joyCli.minimumVersion', () => {
    const extension = vscode.extensions.getExtension('joyint.joy-vscode');
    assert.ok(extension);
    const minimum = extension.packageJSON.joyCli?.minimumVersion;
    assert.equal(typeof minimum, 'string');
    assert.ok(/\d+\.\d+\.\d+/.test(minimum));
  });
});
