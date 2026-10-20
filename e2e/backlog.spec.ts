import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  BACKLOG,
  Project,
  backlogState,
  launch,
  reloading,
  runCommand,
  scrollAndSelect,
  showBacklog,
  webviewFrame,
} from './vscode';

// The backlog keeps the reader's place: scroll position and selection
// survive every reload, a failed one included.
test.describe.configure({ mode: 'serial' });

let project: Project;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  project = new Project();
  for (let s = 0; s < 12; s++) {
    const story = project.add('story', `Story ${s}`);
    for (let t = 0; t < 9; t++) project.add('task', `Task ${s}.${t}`, '--parent', story);
  }
  ({ app, page } = await launch(project));
  await showBacklog(page);
});

test.afterAll(async () => {
  await app?.close();
});

test('switching to the explorer and back keeps the place', async () => {
  const place = await scrollAndSelect(page);
  expect(place.topRow).not.toContain('Story 11');
  const calls = project.calls().length;
  await page.click('.activitybar a[aria-label^="Explorer"]');
  await page.waitForSelector(`${BACKLOG} .monaco-list`, { state: 'hidden' });
  await showBacklog(page);
  const back = await backlogState(page);
  expect(project.calls().length).toBe(calls);
  expect(back.topRow).toBe(place.topRow);
  expect(back.selected).toBe(place.selected);
});

test('a reload while the backlog is hidden keeps the place', async () => {
  const place = await scrollAndSelect(page);
  await page.click('.activitybar a[aria-label^="Explorer"]');
  await page.waitForSelector(`${BACKLOG} .monaco-list`, { state: 'hidden' });
  await reloading(page, project, async () => project.joy('edit', 'FX-0003', '--title', 'Task 0.1 renamed'));
  await showBacklog(page);
  const back = await backlogState(page);
  expect(back.topRow).toBe(place.topRow);
  expect(back.selected).toBe(place.selected);
});

test('the refresh command keeps the place', async () => {
  const place = await scrollAndSelect(page);
  await reloading(page, project, () => runCommand(page, 'Joy: Refresh'));
  expect(await backlogState(page)).toEqual(place);
});

test('an item changed on disk keeps the place', async () => {
  const place = await scrollAndSelect(page);
  await reloading(page, project, async () => project.joy('edit', 'FX-0002', '--title', 'Task 0.0 renamed'));
  expect(await backlogState(page)).toEqual(place);
});

test('a new item through Joy: New Item keeps the selection where it was', async () => {
  const place = await scrollAndSelect(page);
  await reloading(page, project, async () => {
    await runCommand(page, 'Joy: New Item');
    await page.waitForSelector('.quick-input-list .monaco-list-row[aria-label="task"]');
    await page.keyboard.type('task');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.quick-input-box input[placeholder=""], .quick-input-box input');
    await page.keyboard.type('Added during the e2e run');
    await page.keyboard.press('Enter');
    await expect.poll(() => project.calls().some((c) => c.startsWith('done add task'))).toBe(true);
  });
  // the new item lands at the top of the list, above the view: everything
  // in view moves down by its row, which VS Code gives a plugin no way to
  // hold; the selection stays
  const after = await backlogState(page);
  expect(after.selected).toBe(place.selected);
  expect(after.selectedAt! - place.selectedAt!).toBeLessThanOrEqual(22);
});

test('a failed load keeps the place and says why, the next load clears the message', async () => {
  const place = await scrollAndSelect(page);
  project.failNextLs();
  await reloading(page, project, () => runCommand(page, 'Joy: Refresh'));
  const failed = await backlogState(page);
  expect(failed.message).toContain('joy ls failed for the test');
  expect(failed.topRow).toBe(place.topRow);
  expect(failed.selected).toBe(place.selected);

  await reloading(page, project, () => runCommand(page, 'Joy: Refresh'));
  const recovered = await backlogState(page);
  expect(recovered.message).toBeUndefined();
  expect(recovered.selected).toBe(place.selected);
});

test('a collapsed story stays collapsed after a reload', async () => {
  await scrollAndSelect(page);
  const story = page.locator(`${BACKLOG} .monaco-list-row:has(.monaco-tl-twistie.collapsible:not(.collapsed))`).first();
  const label = await story.getAttribute('aria-label');
  await story.locator('.monaco-tl-twistie').click();
  const row = page.locator(`${BACKLOG} .monaco-list-row[aria-label="${label}"] .monaco-tl-twistie`);
  await expect(row).toHaveClass(/collapsed/);
  await reloading(page, project, () => runCommand(page, 'Joy: Refresh'));
  await expect(row).toHaveClass(/collapsed/);
});

test('the item head says since when and by whom, quietly beside the id', async () => {
  await scrollAndSelect(page);
  const frame = await webviewFrame(page, '.item-head .item-since');
  const since = frame.locator('.item-since');
  await expect(since).toHaveText(/^since \d{4}-\d{2}-\d{2} by e2e@example\.com$/);
  const look = await frame.evaluate(() => {
    const id = document.querySelector('.item-id')!.getBoundingClientRect();
    const line = document.querySelector('.item-since')!;
    const box = line.getBoundingClientRect();
    const style = getComputedStyle(line);
    return {
      centreOffset: Math.abs(id.top + id.height / 2 - (box.top + box.height / 2)),
      ellipsis: style.textOverflow,
      wrap: style.whiteSpace,
      font: style.fontFamily,
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
  });
  // centred on the id, cut with an ellipsis, in the panel's font (the id
  // alone keeps the editor's mono font)
  expect(look.centreOffset).toBeLessThan(1);
  expect(look.ellipsis).toBe('ellipsis');
  expect(look.wrap).toBe('nowrap');
  expect(look.font).toBe(look.bodyFont);
});
