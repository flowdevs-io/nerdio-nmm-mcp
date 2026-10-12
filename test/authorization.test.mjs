import assert from 'node:assert/strict';
import test from 'node:test';
import { authorize, poolPath } from '../dist/config.js';

test('account authorization fails closed and supports numeric and UUID account IDs', () => {
  for (const env of [{}, { NERDIO_ALLOWED_ACCOUNT_IDS: '' }, { NERDIO_ALLOWED_ACCOUNT_IDS: '2,3' }, { NERDIO_ALLOWED_ACCOUNT_IDS: '*' }]) {
    assert.throws(() => authorize('1', env), /allowlist/);
  }
  authorize('1', { NERDIO_ALLOWED_ACCOUNT_IDS: ' 1,2 ' });
  authorize('550e8400-e29b-41d4-a716-446655440000', { NERDIO_ALLOWED_ACCOUNT_IDS: '550E8400-E29B-41D4-A716-446655440000' });
  assert.throws(() => authorize('-1', { NERDIO_ALLOWED_ACCOUNT_IDS: '-1' }), /allowlist/);
});

test('resource identifiers reject traversal, flag injection and URL encoding escapes', () => {
  for (const name of ['--help', '..', '../hosts', '%2e%2e', 'pool?account_id=2', 'pool#fragment', 'pool/child', 'pool;command']) {
    assert.throws(() => poolPath({ account_id: '1', subscription_id: 'sub', resource_group: 'rg', pool_name: name }), /identifier/i);
  }
});
