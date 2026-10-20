import { expect, test } from '@playwright/test';
import { ROWS, Project, backlogState, launch, runCommand, showBacklog, webviewFrame } from './vscode';

// joy ls of a large project is more than Node's default 1 MiB buffer.
test('board and backlog load a project whose joy ls is larger than 1 MiB', async () => {
  const project = new Project();
  const description = 'A long description. '.repeat(3000);
  for (let i = 0; i < 20; i++) project.add('task', `Large item ${i}`, '--description', description);
  expect(project.joy('--json', 'ls', '--all').length).toBeGreaterThan(1024 * 1024);

  const { app, page } = await launch(project);
  try {
    await showBacklog(page);
    expect((await backlogState(page)).message).toBeUndefined();
    expect(await page.locator(`${ROWS}`).count()).toBeGreaterThan(0);

    await runCommand(page, 'Joy: Open Board');
    const board = await webviewFrame(page, '#board .card');
    await expect(board.locator('.card')).toHaveCount(20);
    await expect(board.locator('#board')).not.toContainText('maxBuffer');
  } finally {
    await app.close();
  }
});
