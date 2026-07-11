import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class JoyError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
    public readonly stdout: string = '',
  ) {
    super(message);
    this.name = 'JoyError';
  }
}

/**
 * Parse the JSON payload of a `joy --json` invocation. Tolerates a non-JSON
 * prefix on stdout: on the first invocation after a joy upgrade, joy prints a
 * one-time auto-sync summary before the payload. The payload is the final JSON
 * value on stdout, so we fall back to parsing from its first bracket.
 */
export function parseJoyJson<T>(stdout: string): T {
  const text = stdout.trim();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const start = text.search(/[{[]/);
    if (start > 0) {
      return JSON.parse(text.slice(start)) as T;
    }
    throw err;
  }
}

export class JoyExecutableNotFoundError extends JoyError {
  constructor(executable: string) {
    super(
      `joy executable not found: ${executable}. Install joy (https://github.com/joyint/joy) or set joy.executablePath.`,
      '',
      null,
    );
    this.name = 'JoyExecutableNotFoundError';
  }
}

export class JoySessionExpiredError extends JoyError {
  constructor(stderr: string, exitCode: number | null) {
    super('Joy session expired or missing. Re-authenticate to continue.', stderr, exitCode);
    this.name = 'JoySessionExpiredError';
  }
}

export class JoyCapabilityDeniedError extends JoyError {
  constructor(stderr: string, exitCode: number | null) {
    super(`Joy refused the action: ${stderr.trim()}`, stderr, exitCode);
    this.name = 'JoyCapabilityDeniedError';
  }
}

export interface JoyRunResult {
  stdout: string;
  stderr: string;
}

export interface JoyRunOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Written to the child's stdin and closed. Used for --passphrase-stdin. */
  stdin?: string;
  /** Skip the session-expired recovery hook for this call. */
  noAuthRetry?: boolean;
}

export interface JoyClientOptions {
  resolveExecutable: () => string;
  resolveCwd: () => string | undefined;
  /**
   * Called when a command fails with a session-expired error. Return true
   * once re-authentication succeeded; the failed command is retried once.
   */
  onAuthRequired?: () => Promise<boolean>;
}

export class JoyClient {
  constructor(private readonly options: JoyClientOptions) {}

  async run(args: readonly string[], options: JoyRunOptions = {}): Promise<JoyRunResult> {
    try {
      return await this.runOnce(args, options);
    } catch (err) {
      if (
        err instanceof JoySessionExpiredError &&
        !options.noAuthRetry &&
        this.options.onAuthRequired
      ) {
        const authenticated = await this.options.onAuthRequired();
        if (authenticated) {
          return this.runOnce(args, options);
        }
      }
      throw err;
    }
  }

  private runOnce(args: readonly string[], options: JoyRunOptions = {}): Promise<JoyRunResult> {
    const executable = this.options.resolveExecutable();
    const cwd = options.cwd ?? this.options.resolveCwd();
    const timeout = options.timeoutMs ?? 15_000;

    const pending = execFileAsync(executable, [...args], { cwd, timeout });
    if (options.stdin !== undefined) {
      pending.child.stdin?.write(options.stdin);
      pending.child.stdin?.end();
    }
    return pending
      .then(({ stdout, stderr }) => ({ stdout, stderr }))
      .catch(
        (
          err: NodeJS.ErrnoException & {
            stdout?: string;
            stderr?: string;
            code?: number | string;
          },
        ) => {
          if (err.code === 'ENOENT') {
            throw new JoyExecutableNotFoundError(executable);
          }
          const stderr = err.stderr ?? '';
          const stdout = err.stdout ?? '';
          const exitCode = typeof err.code === 'number' ? err.code : null;
          if (/must authenticate|session/i.test(stderr)) {
            throw new JoySessionExpiredError(stderr, exitCode);
          }
          if (/guard denied|capability/i.test(stderr)) {
            throw new JoyCapabilityDeniedError(stderr, exitCode);
          }
          throw new JoyError(stderr.trim() || err.message, stderr, exitCode, stdout);
        },
      );
  }

  async runJson<T = unknown>(args: readonly string[], options: JoyRunOptions = {}): Promise<T> {
    const result = await this.run(['--json', ...args], options);
    return parseJoyJson<T>(result.stdout);
  }

  /**
   * Like {@link runJson}, but returns the parsed stdout even when joy exits
   * non-zero, as long as stdout carries a JSON payload. `joy auth status`
   * exits 1 when unauthenticated yet still prints the status object (with the
   * member) on stdout, so status queries must not treat that exit as fatal.
   */
  async runJsonAllowFailure<T = unknown>(
    args: readonly string[],
    options: JoyRunOptions = {},
  ): Promise<T> {
    try {
      return await this.runJson<T>(args, options);
    } catch (err) {
      if (err instanceof JoyError && err.stdout.trim()) {
        try {
          return parseJoyJson<T>(err.stdout);
        } catch {
          // stdout was not JSON either; surface the original failure.
        }
      }
      throw err;
    }
  }
}
