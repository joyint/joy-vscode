import * as assert from 'node:assert';
import { aiMembers, isAiMember } from '../../members';

describe('members', () => {
  it('tells an AI member from a person the way joy does', () => {
    assert.strictEqual(isAiMember('claude'), true);
    assert.strictEqual(isAiMember('copilot'), true);
    assert.strictEqual(isAiMember('horst@example.com'), false);
    assert.strictEqual(isAiMember('m-abcdefghij'), false);
    assert.strictEqual(isAiMember(''), false);
  });

  it('picks the AI members of a project, sorted', () => {
    assert.deepStrictEqual(
      aiMembers(['horst@example.com', 'vibe', 'm-abcdefghij', 'claude']),
      ['claude', 'vibe'],
    );
    assert.deepStrictEqual(aiMembers(['horst@example.com']), []);
  });
});
