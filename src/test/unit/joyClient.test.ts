import * as assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JoyClient, JoyExecutableNotFoundError } from '../../joyClient';

function makeClient(executable: string): JoyClient {
  return new JoyClient({
    resolveExecutable: () => executable,
    resolveCwd: () => undefined,
  });
}

function writeFakeJoy(dir: string, script: string): string {
  const fake = join(dir, 'fake-joy');
  writeFileSync(fake, script);
  chmodSync(fake, 0o755);
  return fake;
}

describe('JoyClient', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'joyclient-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('throws JoyExecutableNotFoundError when the executable is missing', async () => {
    const client = makeClient(join(tmp, 'definitely-not-joy'));
    await assert.rejects(client.run(['--version']), JoyExecutableNotFoundError);
  });

  it('returns stdout when the wrapped binary exits 0', async () => {
    const fake = writeFakeJoy(tmp, '#!/usr/bin/env bash\necho "joy 0.0.0"\n');
    const result = await makeClient(fake).run(['--version']);
    assert.equal(result.stdout.trim(), 'joy 0.0.0');
  });

  it('maps stderr containing "must authenticate" to JoySessionExpiredError', async () => {
    const fake = writeFakeJoy(
      tmp,
      '#!/usr/bin/env bash\necho "Error: must authenticate" 1>&2\nexit 1\n',
    );
    await assert.rejects(makeClient(fake).run(['ls']), (err: Error) => {
      assert.equal(err.name, 'JoySessionExpiredError');
      return true;
    });
  });

  it('maps stderr containing "guard denied" to JoyCapabilityDeniedError', async () => {
    const fake = writeFakeJoy(
      tmp,
      '#!/usr/bin/env bash\necho "Error: guard denied: capability missing" 1>&2\nexit 1\n',
    );
    await assert.rejects(makeClient(fake).run(['close', 'X-0001-AA']), (err: Error) => {
      assert.equal(err.name, 'JoyCapabilityDeniedError');
      return true;
    });
  });

  it('parses JSON output through runJson', async () => {
    const fake = writeFakeJoy(
      tmp,
      '#!/usr/bin/env bash\necho \'{"version":1,"data":{"hello":"world"}}\'\n',
    );
    const parsed = await makeClient(fake).runJson<{
      version: number;
      data: { hello: string };
    }>(['ls']);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.data.hello, 'world');
  });

  it('wraps non-zero exits without a known pattern as JoyError', async () => {
    const fake = writeFakeJoy(
      tmp,
      '#!/usr/bin/env bash\necho "Error: something else" 1>&2\nexit 2\n',
    );
    await assert.rejects(makeClient(fake).run(['ls']), (err: Error) => {
      assert.equal(err.name, 'JoyError');
      assert.ok(err.message.includes('something else'));
      return true;
    });
  });
});
