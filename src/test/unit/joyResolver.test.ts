import * as assert from 'node:assert/strict';
import {
  JoyResolver,
  type JoyResolverDeps,
  buildCommonJoyPaths,
  compareVersions,
  parseVersion,
} from '../../joyResolver';

function notFoundError(): NodeJS.ErrnoException {
  const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

function makeDeps(overrides: Partial<JoyResolverDeps>): JoyResolverDeps {
  return {
    getConfiguredPath: () => undefined,
    minimumVersion: '0.15.0',
    run: async () => ({ stdout: 'joy 0.15.5\n', stderr: '' }),
    shellLookup: async () => undefined,
    getCommonPaths: () => [],
    pathExists: async () => false,
    ...overrides,
  };
}

describe('compareVersions', () => {
  it('orders by numeric components left to right', () => {
    assert.ok(compareVersions('0.15.5', '0.15.4') > 0);
    assert.ok(compareVersions('0.15.4', '0.15.5') < 0);
    assert.equal(compareVersions('0.15.5', '0.15.5'), 0);
  });

  it('treats missing trailing components as zero', () => {
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.ok(compareVersions('1.1', '1.0.999') > 0);
  });

  it('ignores non-numeric suffix segments after the numeric core', () => {
    assert.equal(compareVersions('0.15.5-rc1', '0.15.5'), 0);
  });
});

describe('parseVersion', () => {
  it('extracts the semver-like core from joy --version output', () => {
    assert.equal(parseVersion('joy 0.15.5\n'), '0.15.5');
  });

  it('handles pre-release tails', () => {
    assert.equal(parseVersion('joy 0.16.0-rc1\n'), '0.16.0-rc1');
  });

  it('returns undefined for unrecognized output', () => {
    assert.equal(parseVersion('not a version'), undefined);
  });
});

describe('JoyResolver.resolve', () => {
  it('probes the configured path and never falls back when set', async () => {
    let runCalls = 0;
    let shellCalls = 0;
    const resolver = new JoyResolver(
      makeDeps({
        getConfiguredPath: () => '/opt/custom/joy',
        run: async (executable) => {
          runCalls += 1;
          assert.equal(executable, '/opt/custom/joy');
          return { stdout: 'joy 0.15.5\n', stderr: '' };
        },
        shellLookup: async () => {
          shellCalls += 1;
          return '/should/not/be/called';
        },
      }),
    );

    const result = await resolver.resolve();
    assert.deepEqual(result, { kind: 'ok', executable: '/opt/custom/joy', version: '0.15.5' });
    assert.equal(runCalls, 1);
    assert.equal(shellCalls, 0);
  });

  it('reports missing with configured path when the configured binary is absent', async () => {
    const resolver = new JoyResolver(
      makeDeps({
        getConfiguredPath: () => '/opt/missing/joy',
        run: async () => {
          throw notFoundError();
        },
      }),
    );
    const result = await resolver.resolve();
    assert.deepEqual(result, {
      kind: 'missing',
      configured: '/opt/missing/joy',
      triedShell: false,
    });
  });

  it('falls back to shell lookup when bare joy is not on PATH', async () => {
    const probed: string[] = [];
    const resolver = new JoyResolver(
      makeDeps({
        run: async (executable) => {
          probed.push(executable);
          if (executable === 'joy') throw notFoundError();
          return { stdout: 'joy 0.15.5\n', stderr: '' };
        },
        shellLookup: async () => '/home/u/.local/bin/joy',
      }),
    );
    const result = await resolver.resolve();
    assert.equal(result.kind, 'ok');
    assert.deepEqual(probed, ['joy', '/home/u/.local/bin/joy']);
  });

  it('reports missing with triedShell=true when no path can be resolved', async () => {
    const resolver = new JoyResolver(
      makeDeps({
        run: async () => {
          throw notFoundError();
        },
        shellLookup: async () => undefined,
      }),
    );
    const result = await resolver.resolve();
    assert.deepEqual(result, { kind: 'missing', triedShell: true });
  });

  it('flags tooOld when the version is below the minimum', async () => {
    const resolver = new JoyResolver(
      makeDeps({
        minimumVersion: '0.16.0',
        run: async () => ({ stdout: 'joy 0.15.5\n', stderr: '' }),
      }),
    );
    const result = await resolver.resolve();
    assert.deepEqual(result, {
      kind: 'tooOld',
      executable: 'joy',
      version: '0.15.5',
      minimum: '0.16.0',
    });
  });

  it('returns unreadable when --version output is unparseable', async () => {
    const resolver = new JoyResolver(
      makeDeps({
        run: async () => ({ stdout: 'gibberish\n', stderr: '' }),
      }),
    );
    const result = await resolver.resolve();
    assert.equal(result.kind, 'unreadable');
  });

  it('returns unreadable when probing throws a non-ENOENT error', async () => {
    const resolver = new JoyResolver(
      makeDeps({
        run: async () => {
          throw new Error('permission denied');
        },
      }),
    );
    const result = await resolver.resolve();
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') {
      assert.ok(result.error.includes('permission denied'));
    }
  });

  it('falls through to common install paths when bare and shell both fail', async () => {
    const probed: string[] = [];
    const exists = new Set(['/home/u/.local/bin/joy']);
    const resolver = new JoyResolver(
      makeDeps({
        run: async (executable) => {
          probed.push(executable);
          if (executable === 'joy') throw notFoundError();
          return { stdout: 'joy 0.15.5\n', stderr: '' };
        },
        shellLookup: async () => undefined,
        getCommonPaths: () => [
          '/opt/local/bin/joy',
          '/home/u/.local/bin/joy',
          '/home/u/go/bin/joy',
        ],
        pathExists: async (p) => exists.has(p),
      }),
    );
    const result = await resolver.resolve();
    assert.deepEqual(result, {
      kind: 'ok',
      executable: '/home/u/.local/bin/joy',
      version: '0.15.5',
    });
    assert.deepEqual(probed, ['joy', '/home/u/.local/bin/joy']);
  });

  it('skips common paths that do not exist before probing', async () => {
    const probedExecutables: string[] = [];
    const existsCalls: string[] = [];
    const resolver = new JoyResolver(
      makeDeps({
        run: async (executable) => {
          probedExecutables.push(executable);
          throw notFoundError();
        },
        getCommonPaths: () => ['/a/joy', '/b/joy', '/c/joy'],
        pathExists: async (p) => {
          existsCalls.push(p);
          return false;
        },
      }),
    );
    const result = await resolver.resolve();
    assert.deepEqual(result, { kind: 'missing', triedShell: true });
    assert.deepEqual(probedExecutables, ['joy']);
    assert.deepEqual(existsCalls, ['/a/joy', '/b/joy', '/c/joy']);
  });

  it('continues common-path probing when the first existing candidate is too old', async () => {
    const exists = new Set(['/opt/old/joy', '/opt/new/joy']);
    const resolver = new JoyResolver(
      makeDeps({
        minimumVersion: '0.15.0',
        run: async (executable) => {
          if (executable === 'joy') throw notFoundError();
          if (executable === '/opt/old/joy') {
            return { stdout: 'joy 0.10.0\n', stderr: '' };
          }
          return { stdout: 'joy 0.15.5\n', stderr: '' };
        },
        getCommonPaths: () => ['/opt/old/joy', '/opt/new/joy'],
        pathExists: async (p) => exists.has(p),
      }),
    );
    const result = await resolver.resolve();
    assert.equal(result.kind, 'tooOld');
    if (result.kind === 'tooOld') {
      assert.equal(result.executable, '/opt/old/joy');
    }
  });
});

describe('buildCommonJoyPaths', () => {
  it('returns Linux/macOS paths with posix separators', () => {
    const paths = buildCommonJoyPaths({ platform: 'linux', home: '/home/u', env: {} });
    assert.ok(paths.includes('/home/u/.local/bin/joy'));
    assert.ok(paths.includes('/usr/local/bin/joy'));
    assert.ok(paths.includes('/opt/homebrew/bin/joy'));
    assert.ok(paths.includes('/home/u/go/bin/joy'));
    assert.ok(paths.includes('/home/u/.cargo/bin/joy'));
    for (const p of paths) {
      assert.ok(!p.includes('\\'), `unix path ${p} should not contain backslashes`);
      assert.ok(!p.endsWith('.exe'), `unix path ${p} should not end in .exe`);
    }
  });

  it('returns macOS-specific Homebrew paths', () => {
    const paths = buildCommonJoyPaths({ platform: 'darwin', home: '/Users/u', env: {} });
    assert.ok(paths.includes('/opt/homebrew/bin/joy'));
    assert.ok(paths.includes('/Users/u/.local/bin/joy'));
  });

  it('returns Windows paths with .exe and backslash separators', () => {
    const paths = buildCommonJoyPaths({
      platform: 'win32',
      home: 'C:\\Users\\u',
      env: {
        ProgramFiles: 'C:\\Program Files',
        LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
      },
    });
    assert.ok(paths.includes('C:\\Users\\u\\.local\\bin\\joy.exe'));
    assert.ok(paths.includes('C:\\Users\\u\\AppData\\Local\\Programs\\joy\\joy.exe'));
    assert.ok(paths.includes('C:\\Users\\u\\go\\bin\\joy.exe'));
    assert.ok(paths.includes('C:\\Users\\u\\.cargo\\bin\\joy.exe'));
    assert.ok(paths.includes('C:\\Program Files\\joy\\joy.exe'));
    for (const p of paths) {
      assert.ok(p.endsWith('.exe'), `windows path ${p} should end in .exe`);
    }
  });

  it('falls back to defaults when Windows env vars are unset', () => {
    const paths = buildCommonJoyPaths({ platform: 'win32', home: 'C:\\Users\\u', env: {} });
    assert.ok(paths.some((p) => p.startsWith('C:\\Program Files\\joy')));
    assert.ok(paths.some((p) => p.includes('AppData\\Local\\Programs\\joy')));
  });
});
