import { _electron as electron, expect, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXTENSION = resolve(__dirname, '..');

/** The joy the specs run: JOY_BIN, else the joy on PATH. */
export const JOY = process.env.JOY_BIN ?? 'joy';

/** A joy project in a fresh directory, built with joy itself. */
export class Project {
  readonly dir: string;
  /** Every joy call the plugin makes, one line each. */
  readonly callLog: string;
  private readonly failFlag: string;
  readonly wrapper: string;

  constructor() {
    const root = mkdtempSync(join(tmpdir(), 'joy-vscode-e2e-'));
    this.dir = join(root, 'project');
    mkdirSync(this.dir);
    this.callLog = join(root, 'calls.log');
    this.failFlag = join(root, 'fail-next-ls');
    // The plugin runs joy through this wrapper: it logs every call and its
    // return, and fails the next `ls` once when asked to.
    this.wrapper = join(root, 'joy');
    writeFileSync(
      this.wrapper,
      [
        '#!/usr/bin/env bash',
        `echo "$*" >> '${this.callLog}'`,
        `if [[ " $* " == *" ls "* && -e '${this.failFlag}' ]]; then`,
        `  rm -f '${this.failFlag}'; echo "Error: joy ls failed for the test" >&2; exit 1`,
        'fi',
        `'${JOY}' "$@"`,
        'code=$?',
        `echo "done $*" >> '${this.callLog}'`,
        'exit $code',
        '',
      ].join('\n'),
    );
    chmodSync(this.wrapper, 0o755);
    this.git('init', '-q');
    this.git('config', 'user.email', 'e2e@example.com');
    this.git('config', 'user.name', 'E2E');
    this.joy('init', '--name', 'Fixture', '--acronym', 'FX', '--user', 'e2e@example.com');
  }

  git(...args: string[]): void {
    execFileSync('git', args, { cwd: this.dir });
  }

  joy(...args: string[]): string {
    return execFileSync(JOY, args, { cwd: this.dir, maxBuffer: Infinity }).toString();
  }

  /** Add an item and return its id. */
  add(type: string, title: string, ...flags: string[]): string {
    const out = this.joy('add', type, title, ...flags);
    const id = out.match(/Created (\S+)/)?.[1];
    if (!id) throw new Error(`joy add printed no id: ${out}`);
    return id;
  }

  failNextLs(): void {
    writeFileSync(this.failFlag, '');
  }

  /** How many `ls` calls have returned so far. */
  finishedLs(): number {
    return this.calls().filter((line) => /^done .*\bls\b/.test(line)).length;
  }

  calls(): string[] {
    return existsSync(this.callLog) ? readFileSync(this.callLog, 'utf8').split('\n').filter(Boolean) : [];
  }
}

/** VS Code with the plugin from this checkout, opened on the project. */
export async function launch(project: Project): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = await downloadAndUnzipVSCode({
    version: 'stable',
    cachePath: join(EXTENSION, '.vscode-test'),
  });
  const userData = join(project.dir, '..', 'user-data');
  mkdirSync(join(userData, 'User'), { recursive: true });
  writeFileSync(
    join(userData, 'User', 'settings.json'),
    JSON.stringify({
      'joy.executablePath': project.wrapper,
      'security.workspace.trust.enabled': false,
      'workbench.startupEditor': 'none',
      'update.mode': 'none',
      'telemetry.telemetryLevel': 'off',
      // dialogs drawn in the window, where the specs can answer them
      'window.dialogStyle': 'custom',
    }),
  );
  const app = await electron.launch({
    executablePath,
    args: [
      project.dir,
      `--extensionDevelopmentPath=${EXTENSION}`,
      `--user-data-dir=${userData}`,
      `--extensions-dir=${join(userData, 'extensions')}`,
      '--disable-gpu',
      '--no-sandbox',
      '--skip-release-notes',
      '--disable-workspace-trust',
    ],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.activitybar');
  // The first-run welcome dialog covers the workbench.
  const welcome = page.locator('.onboarding-a-overlay.visible');
  await welcome.waitFor({ timeout: 15_000 }).catch(() => undefined);
  if (await welcome.isVisible()) {
    await welcome.locator('[aria-label="Close"]').click();
    await welcome.waitFor({ state: 'detached' });
  }
  return { app, page };
}

export const BACKLOG = '.pane:has(.pane-header[aria-label*="Backlog"])';
/** The backlog's rows, without the parents VS Code's sticky scroll repeats over the top. */
export const ROWS = `${BACKLOG} .monaco-list-rows > .monaco-list-row`;

/** Show the Joy view; its activity bar icon toggles, so click only while hidden. */
export async function showBacklog(page: Page): Promise<void> {
  if (!(await page.isVisible(`${BACKLOG} .monaco-list`))) {
    await page.click('.activitybar a[aria-label^="Joy"]');
  }
  await page.waitForSelector(ROWS);
}

export async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type(title);
  // click the command itself: Enter would take whatever the fuzzy match put first
  const rows = page.locator('.quick-input-list .monaco-list-row');
  await expect(rows.first()).toBeVisible();
  for (let tries = 0; tries < 50; tries++) {
    for (const row of await rows.all()) {
      const label = (await row.getAttribute('aria-label')) ?? '';
      if (label === title || label.startsWith(`${title},`)) {
        await row.click();
        return;
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`no command ${title}`);
}

export interface BacklogState {
  /** The id of the row at the top of the view, as the reader sees it. */
  topId?: string;
  /** How far the selected row sits below the top of the view, in pixels. */
  selectedAt?: number;
  selectedId?: string;
  message?: string;
}

const ID = /\b([A-Z]{2,5}-[0-9A-F]{4}-[0-9A-F]{2})\b/;

/** What the reader sees of the backlog: the top row, the selection and where it sits, the message. */
export async function backlogState(page: Page): Promise<BacklogState> {
  return page.evaluate(
    ([pane, id]) => {
      const p = document.querySelector(pane)!;
      const view = p.querySelector('.monaco-list')?.getBoundingClientRect();
      const rows = [...p.querySelectorAll('.monaco-list-rows > .monaco-list-row')];
      const idOf = (r?: Element) => r?.getAttribute('aria-label')?.match(new RegExp(id))?.[1];
      const top = view && rows.find((r) => r.getBoundingClientRect().bottom > view.top + 1);
      const selected = rows.find((r) => r.classList.contains('selected'));
      return {
        topId: idOf(top),
        selectedAt: selected && view ? Math.round(selected.getBoundingClientRect().top - view.top) : undefined,
        selectedId: idOf(selected),
        message: p.querySelector('.message')?.textContent?.trim() || undefined,
      };
    },
    [BACKLOG, ID.source],
  );
}

/** Where the row of an item sits below the top of the view, in pixels; undefined when it is not drawn. */
export async function rowOffset(page: Page, itemId: string): Promise<number | undefined> {
  return page.evaluate(
    ([pane, itemId]) => {
      const p = document.querySelector(pane)!;
      const view = p.querySelector('.monaco-list')!.getBoundingClientRect();
      const row = [...p.querySelectorAll('.monaco-list-rows > .monaco-list-row')].find((r) =>
        (r.getAttribute('aria-label') ?? '').includes(itemId),
      );
      return row ? Math.round(row.getBoundingClientRect().top - view.top) : undefined;
    },
    [BACKLOG, itemId],
  );
}

/** How many drawn backlog rows show the item. */
export async function rowsOf(page: Page, itemId: string): Promise<number> {
  return page.locator(`${ROWS}[aria-label*="${itemId}"]`).count();
}

/** One row of the backlog, in pixels. */
export const ROW = 22;

/**
 * Scroll the backlog until the row titled `anchor` is at the top of the view
 * and select the row under the middle. Ctrl+Down (VS Code's list.scrollDown)
 * moves the list by exactly one row, so every start is alike; the mouse
 * wheel scrolls by varying amounts.
 */
export async function scrollAndSelect(page: Page, anchor = 'Story 9'): Promise<BacklogState> {
  const box = (await page.locator(`${BACKLOG} .monaco-list`).boundingBox())!;
  // keys go to the list (a first open of the item detail takes the focus)
  await page.locator(`${BACKLOG} .monaco-list`).focus();
  await page.keyboard.press('Home');
  const anchorAt = () =>
    page.evaluate(
      ([rows, anchor]) => {
        const view = document.querySelector(rows.split(' .monaco-list-rows')[0] + ' .monaco-list')!.getBoundingClientRect();
        const row = [...document.querySelectorAll(rows)].find((r) =>
          (r.getAttribute('aria-label') ?? '').startsWith(`${anchor} `),
        );
        return row ? row.getBoundingClientRect().top - view.top : Infinity;
      },
      [ROWS, anchor],
    );
  for (let i = 0; i < 400 && (await anchorAt()) > 0; i++) {
    await page.keyboard.press('Control+ArrowDown');
  }
  if ((await anchorAt()) > 0) throw new Error(`could not scroll ${anchor} to the top`);
  await settled(page);
  // the row under the middle of the view: a row cut off at an edge would be
  // scrolled fully into view by the click itself
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return settled(page);
}

/** The backlog state once the list stopped scrolling (wheel events land late). */
async function settled(page: Page): Promise<BacklogState> {
  let last = await backlogState(page);
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(100);
    const now = await backlogState(page);
    if (now.topId === last.topId && now.selectedAt === last.selectedAt) return now;
    last = now;
  }
  throw new Error('the backlog did not stop scrolling');
}

/**
 * Run an action that makes the backlog load again and wait until that load
 * has returned and the tree had the moment to show it.
 */
export async function reloading(page: Page, project: Project, action: () => Promise<unknown>): Promise<void> {
  const before = project.finishedLs();
  await action();
  await expect.poll(() => project.finishedLs(), { timeout: 30_000 }).toBeGreaterThan(before);
  // joy has answered; the extension host hands the tree to the window next.
  await page.waitForTimeout(500);
}

/** The webview frame that holds the selector (webviews nest two iframes). */
export async function webviewFrame(page: Page, selector: string): Promise<Frame> {
  for (let i = 0; i < 100; i++) {
    for (const frame of page.frames()) {
      if (await frame.$(selector).catch(() => null)) return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`no webview shows ${selector}`);
}
