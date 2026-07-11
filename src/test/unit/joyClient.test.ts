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

  it('runJsonAllowFailure returns stdout JSON even when joy exits non-zero', async () => {
    // joy auth status exits 1 when unauthenticated but still prints the status
    // (with the member) on stdout.
    const fake = writeFakeJoy(
      tmp,
      '#!/usr/bin/env bash\necho \'{"version":1,"data":{"authenticated":false,"member":"me@example.com"}}\'\nexit 1\n',
    );
    const parsed = await makeClient(fake).runJsonAllowFailure<{
      data: { authenticated: boolean; member: string };
    }>(['auth', 'status']);
    assert.equal(parsed.data.authenticated, false);
    assert.equal(parsed.data.member, 'me@example.com');
  });

  it('runJson tolerates a non-JSON prefix before the payload', async () => {
    // Mirrors joy's one-time auto-sync summary printed before --json output.
    const fake = writeFakeJoy(
      tmp,
      '#!/usr/bin/env bash\nprintf \'Repo state\\n----\\n  version marker stamped\\n\\n{"version":1,"data":{"ok":true}}\\n\'\n',
    );
    const parsed = await makeClient(fake).runJson<{ data: { ok: boolean } }>(['auth', 'status']);
    assert.equal(parsed.data.ok, true);
  });

  it('passes stdin content to the child process', async () => {
    const fake = writeFakeJoy(tmp, '#!/usr/bin/env bash\nread -r line\necho "got: $line"\n');
    const result = await makeClient(fake).run(['auth'], { stdin: 'secret\n' });
    assert.equal(result.stdout.trim(), 'got: secret');
  });

  it('retries once after onAuthRequired resolves true', async () => {
    const marker = join(tmp, 'authed');
    const fake = writeFakeJoy(
      tmp,
      `#!/usr/bin/env bash\nif [ -f "${marker}" ]; then echo ok; else echo "must authenticate" 1>&2; exit 1; fi\n`,
    );
    let prompts = 0;
    const client = new JoyClient({
      resolveExecutable: () => fake,
      resolveCwd: () => undefined,
      onAuthRequired: () => {
        prompts += 1;
        writeFileSync(marker, '');
        return Promise.resolve(true);
      },
    });
    const result = await client.run(['ls']);
    assert.equal(result.stdout.trim(), 'ok');
    assert.equal(prompts, 1);
  });

  it('does not retry when noAuthRetry is set', async () => {
    const fake = writeFakeJoy(
      tmp,
      '#!/usr/bin/env bash\necho "must authenticate" 1>&2\nexit 1\n',
    );
    let prompts = 0;
    const client = new JoyClient({
      resolveExecutable: () => fake,
      resolveCwd: () => undefined,
      onAuthRequired: () => {
        prompts += 1;
        return Promise.resolve(true);
      },
    });
    await assert.rejects(client.run(['ls'], { noAuthRetry: true }));
    assert.equal(prompts, 0);
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
