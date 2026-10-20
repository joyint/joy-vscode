import { expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import {
  BACKLOG,
  Project,
  ROW,
  ROWS,
  backlogState,
  launch,
  reloading,
  rowOffset,
  rowsOf,
  runCommand,
  scrollAndSelect,
  showBacklog,
  webviewFrame,
  type BacklogState,
} from './vscode';

// The backlog keeps the reader's place: the row at the top of the view, the
// selection and where it sits survive every reload, a failed one included.
test.describe.configure({ mode: 'serial' });

let project: Project;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  project = new Project();
  for (let s = 0; s < 15; s++) {
    const story = project.add('story', `Story ${s}`);
    for (let t = 0; t < 9; t++) project.add('task', `Task ${s}.${t}`, '--parent', story);
  }
  ({ app, page } = await launch(project));
  await showBacklog(page);
});

test.afterAll(async () => {
  await app?.close();
});

/** The place is exactly where it was. */
async function expectPlaceKept(place: BacklogState): Promise<void> {
  const now = await backlogState(page);
  expect(now.topId).toBe(place.topId);
  expect(now.selectedId).toBe(place.selectedId);
  expect(now.selectedAt).toBe(place.selectedAt);
  expect(now.message).toBeUndefined();
}

/** The item detail of the selected item. */
async function detailOf(itemId: string): Promise<Frame> {
  const frame = await webviewFrame(page, '.item-head .item-id');
  await expect(frame.locator('.item-id')).toHaveText(itemId);
  return frame;
}

test('switching to the explorer and back keeps the place, without asking joy', async () => {
  const place = await scrollAndSelect(page);
  expect(place.topId).toBeDefined();
  const calls = project.calls().length;
  await page.click('.activitybar a[aria-label^="Explorer"]');
  await page.waitForSelector(`${BACKLOG} .monaco-list`, { state: 'hidden' });
  await showBacklog(page);
  expect(project.calls().length).toBe(calls);
  // VS Code itself puts the view back to within a row of where it was
  const back = await backlogState(page);
  expect(back.topId).toBe(place.topId);
  expect(back.selectedId).toBe(place.selectedId);
  expect(Math.abs(back.selectedAt! - place.selectedAt!)).toBeLessThan(ROW);
});

test('a reload while the backlog is hidden keeps the place', async () => {
  const place = await scrollAndSelect(page);
  await page.click('.activitybar a[aria-label^="Explorer"]');
  await page.waitForSelector(`${BACKLOG} .monaco-list`, { state: 'hidden' });
  await reloading(page, project, async () => project.joy('edit', 'FX-0003', '--title', 'Task 0.1 renamed'));
  await showBacklog(page);
  const back = await backlogState(page);
  expect(back.topId).toBe(place.topId);
  expect(back.selectedId).toBe(place.selectedId);
  expect(Math.abs(back.selectedAt! - place.selectedAt!)).toBeLessThan(ROW);
});

test('the refresh command keeps the place', async () => {
  const place = await scrollAndSelect(page);
  await reloading(page, project, () => runCommand(page, 'Joy: Refresh Backlog'));
  await expectPlaceKept(place);
});

test('an item changed on disk keeps the place', async () => {
  const place = await scrollAndSelect(page);
  await reloading(page, project, async () => project.joy('edit', 'FX-0002', '--title', 'Task 0.0 renamed'));
  await expectPlaceKept(place);
});

test('closing, reopening, starting and submitting the selected item keep the place', async () => {
  const place = await scrollAndSelect(page);
  for (const command of ['Joy: Close', 'Joy: Reopen', 'Joy: Start', 'Joy: Submit for Review']) {
    await reloading(page, project, () => runCommand(page, command));
    await expectPlaceKept(place);
  }
  expect(project.calls().filter((c) => /^done (close|reopen|start|submit) /.test(c))).toHaveLength(4);
});

test('a status change in the item detail keeps the place and shows the item once', async () => {
  const place = await scrollAndSelect(page);
  const detail = await detailOf(place.selectedId!);
  await reloading(page, project, () => detail.locator('.status-segment', { hasText: /^deferred$/ }).click());
  await expectPlaceKept(place);
  expect(await rowsOf(page, place.selectedId!)).toBe(1);
  await expect(detail.locator('.status-segment.current')).toHaveText('deferred');
});

test('a title edit in the item detail keeps the place', async () => {
  const place = await scrollAndSelect(page);
  const detail = await detailOf(place.selectedId!);
  await detail.locator('.title-row h2').click();
  await detail.locator('.title-row input').fill('Edited in the detail');
  await reloading(page, project, () => detail.locator('.title-row input').press('Enter'));
  await expectPlaceKept(place);
});

test('moving a card on the board keeps the backlog place and shows the item once', async () => {
  const place = await scrollAndSelect(page);
  await runCommand(page, 'Joy: Open Board');
  const board = await webviewFrame(page, '#board .card');
  const card = board.locator('.card', { hasText: place.selectedId! });
  await expect(card).toHaveCount(1);
  // the item came out of the previous test deferred: over to open, then back
  for (const column of ['open', 'deferred']) {
    await reloading(page, project, () => card.dragTo(board.locator(`.column[data-column="${column}"]`)));
    await expectPlaceKept(place);
    await expect(board.locator(`.column[data-column="${column}"] .card`, { hasText: place.selectedId! })).toHaveCount(1);
  }
  expect(await rowsOf(page, place.selectedId!)).toBe(1);
  await expect(board.locator('.column[data-column="deferred"] .card', { hasText: place.selectedId! })).toHaveCount(1);
  await expect(board.locator('.card', { hasText: place.selectedId! })).toHaveCount(1);
  await page.keyboard.press('Control+W');
});

test('deleting the selected item in the detail leaves the rows above it in place', async () => {
  const place = await scrollAndSelect(page);
  const detail = await detailOf(place.selectedId!);
  const topAt = await rowOffset(page, place.topId!);
  await detail.locator('.delete-button').click();
  await reloading(page, project, () => page.locator('.monaco-dialog-box .monaco-button', { hasText: /^Delete$/ }).click());
  expect(await rowsOf(page, place.selectedId!)).toBe(0);
  expect((await backlogState(page)).topId).toBe(place.topId);
  expect(await rowOffset(page, place.topId!)).toBe(topAt);
});

test('an item deleted above the view moves the rows in view by its row at most', async () => {
  const place = await scrollAndSelect(page);
  // a task of the second newest story: near the top of the list, far above the view
  const above = await rowOffset(page, 'FX-0087');
  expect(above === undefined || above < 0).toBe(true);
  await reloading(page, project, async () => project.joy('rm', 'FX-0087', '--force'));
  const now = await backlogState(page);
  expect(now.selectedId).toBe(place.selectedId);
  expect(Math.abs(now.selectedAt! - place.selectedAt!)).toBeLessThanOrEqual(ROW);
});

test('dragging an item onto another story leaves the rows above it in place', async () => {
  const place = await scrollAndSelect(page);
  // the selected task onto the next story below it in the view: never its
  // own parent, which sits above it (a drop there is a no-op on purpose)
  const storyLabel = await page.evaluate(
    ([rows, selectedAt]) => {
      const view = document.querySelector('.pane:has(.pane-header[aria-label*="Backlog"]) .monaco-list')!.getBoundingClientRect();
      return [...document.querySelectorAll(rows)]
        .filter((r) => (r.getAttribute('aria-label') ?? '').startsWith('Story '))
        .map((r) => ({ label: r.getAttribute('aria-label')!, at: r.getBoundingClientRect().top - view.top }))
        .filter((r) => r.at > Number(selectedAt) && r.at + 22 < view.height)
        .sort((a, b) => a.at - b.at)[0]?.label;
    },
    [ROWS, String(place.selectedAt)],
  );
  expect(storyLabel).toBeDefined();
  const story = page.locator(`${ROWS}[aria-label="${storyLabel}"]`);
  const storyId = (await story.getAttribute('aria-label'))!.match(/FX-[0-9A-F]{4}-[0-9A-F]{2}/)![0];
  const topAt = (await rowOffset(page, place.topId!))!;
  const source = page.locator(`${ROWS}[aria-label*="${place.selectedId}"]`);
  // by hand, in steps: VS Code's tree takes a drop only after dragover
  // events along the way
  await reloading(page, project, async () => {
    const from = (await source.boundingBox())!;
    const to = (await story.boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 20 });
    await page.mouse.up();
  });
  expect(project.calls()).toContain(`done edit ${place.selectedId} --parent ${storyId}`);
  const now = await backlogState(page);
  expect(now.topId).toBe(place.topId);
  expect(await rowOffset(page, place.topId!)).toBe(topAt);
  expect(now.selectedId).toBe(place.selectedId);
});

test('a new item through Joy: New Item keeps the selection where it was', async () => {
  const place = await scrollAndSelect(page);
  await reloading(page, project, async () => {
    await runCommand(page, 'Joy: New Item...');
    await page.click('.quick-input-list .monaco-list-row[aria-label="task"]');
    const title = page.locator('.quick-input-widget:visible .quick-input-box input');
    await expect(page.locator('.quick-input-widget:visible .quick-input-message')).toContainText('Title for the new task');
    await title.fill('Added during the e2e run');
    await title.press('Enter');
    await expect.poll(() => project.calls().some((c) => c.startsWith('done add task'))).toBe(true);
  });
  // the new item lands at the top of the list, above the view: the rows in
  // view move down by its row, which VS Code gives a plugin no way to hold
  const after = await backlogState(page);
  expect(after.selectedId).toBe(place.selectedId);
  expect(after.selectedAt! - place.selectedAt!).toBeLessThanOrEqual(ROW);
});

test('a failed load keeps the place and says why, the next load clears the message', async () => {
  const place = await scrollAndSelect(page);
  project.failNextLs();
  await reloading(page, project, () => runCommand(page, 'Joy: Refresh Backlog'));
  const failed = await backlogState(page);
  expect(failed.message).toContain('joy ls failed for the test');
  expect(failed.topId).toBe(place.topId);
  expect(failed.selectedId).toBe(place.selectedId);

  await reloading(page, project, () => runCommand(page, 'Joy: Refresh Backlog'));
  await expectPlaceKept(place);
});

test('a collapsed story stays collapsed after a reload', async () => {
  await scrollAndSelect(page);
  const story = page.locator(`${ROWS}:has(.monaco-tl-twistie.collapsible:not(.collapsed))`).first();
  const label = await story.getAttribute('aria-label');
  await story.locator('.monaco-tl-twistie').click();
  const twistie = page.locator(`${ROWS}[aria-label="${label}"] .monaco-tl-twistie`);
  await expect(twistie).toHaveClass(/collapsed/);
  await reloading(page, project, () => runCommand(page, 'Joy: Refresh Backlog'));
  await expect(twistie).toHaveClass(/collapsed/);
});

test('the item head says since when and by whom, quietly beside the id', async () => {
  const place = await scrollAndSelect(page);
  const frame = await detailOf(place.selectedId!);
  await expect(frame.locator('.item-since')).toHaveText(/^since \d{4}-\d{2}-\d{2} by e2e@example\.com$/);
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
