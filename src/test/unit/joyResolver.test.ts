import * as assert from 'node:assert/strict';
import {
  JoyResolver,
  type JoyResolverDeps,
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
});
