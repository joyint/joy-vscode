export type JoyResolution =
  | { kind: 'ok'; executable: string; version: string }
  | { kind: 'missing'; configured?: string; triedShell: boolean }
  | { kind: 'tooOld'; executable: string; version: string; minimum: string }
  | { kind: 'unreadable'; executable: string; error: string };

export interface JoyResolverDeps {
  getConfiguredPath: () => string | undefined;
  minimumVersion: string;
  run: (executable: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  shellLookup: () => Promise<string | undefined>;
}

export class JoyResolver {
  constructor(private readonly deps: JoyResolverDeps) {}

  async resolve(): Promise<JoyResolution> {
    const configured = this.deps.getConfiguredPath()?.trim();
    if (configured) {
      const probed = await this.probeOrMissing(configured);
      if (probed.kind === 'missing') {
        return { kind: 'missing', configured, triedShell: false };
      }
      return probed;
    }

    const direct = await this.probeOrMissing('joy');
    if (direct.kind !== 'missing') {
      return direct;
    }

    const shellPath = await this.deps.shellLookup();
    if (shellPath) {
      const fromShell = await this.probeOrMissing(shellPath);
      if (fromShell.kind === 'missing') {
        return { kind: 'missing', triedShell: true };
      }
      return fromShell;
    }

    return { kind: 'missing', triedShell: true };
  }

  private async probeOrMissing(
    executable: string,
  ): Promise<
    | Exclude<JoyResolution, { kind: 'missing'; configured?: string; triedShell: boolean }>
    | { kind: 'missing' }
  > {
    let stdout: string;
    try {
      const result = await this.deps.run(executable, ['--version']);
      stdout = result.stdout;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { kind: 'missing' };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'unreadable', executable, error: message };
    }

    const version = parseVersion(stdout);
    if (!version) {
      return {
        kind: 'unreadable',
        executable,
        error: `unexpected --version output: ${stdout.trim()}`,
      };
    }
    if (compareVersions(version, this.deps.minimumVersion) < 0) {
      return { kind: 'tooOld', executable, version, minimum: this.deps.minimumVersion };
    }
    return { kind: 'ok', executable, version };
  }
}

export function parseVersion(versionOutput: string): string | undefined {
  const match = versionOutput.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
  return match?.[1];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseNumericParts(a);
  const pb = parseNumericParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function parseNumericParts(version: string): number[] {
  return version
    .split(/[.\-+]/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n));
}
