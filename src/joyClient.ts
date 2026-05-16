import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class JoyError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'JoyError';
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
}

export interface JoyClientOptions {
  resolveExecutable: () => string;
  resolveCwd: () => string | undefined;
}

export class JoyClient {
  constructor(private readonly options: JoyClientOptions) {}

  run(args: readonly string[], options: JoyRunOptions = {}): Promise<JoyRunResult> {
    const executable = this.options.resolveExecutable();
    const cwd = options.cwd ?? this.options.resolveCwd();
    const timeout = options.timeoutMs ?? 15_000;

    return execFileAsync(executable, [...args], { cwd, timeout })
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
          const exitCode = typeof err.code === 'number' ? err.code : null;
          if (/must authenticate|session/i.test(stderr)) {
            throw new JoySessionExpiredError(stderr, exitCode);
          }
          if (/guard denied|capability/i.test(stderr)) {
            throw new JoyCapabilityDeniedError(stderr, exitCode);
          }
          throw new JoyError(stderr.trim() || err.message, stderr, exitCode);
        },
      );
  }

  async runJson<T = unknown>(args: readonly string[], options: JoyRunOptions = {}): Promise<T> {
    const result = await this.run(['--json', ...args], options);
    return JSON.parse(result.stdout) as T;
  }
}
