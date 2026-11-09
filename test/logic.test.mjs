import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalPoints, displayStatus, validPin, roleForEmail, tokenAlive, lockoutAfterFail, TOKEN_IDLE_MS } from '../src/logic.js';

const env = { QUEEN_EMAIL: 'liorgra8@gmail.com', SLAVE_EMAIL: 'yogevabr@gmail.com' };

test('only the two emails get a role', () => {
  assert.equal(roleForEmail('liorgra8@gmail.com', env), 'queen');
  assert.equal(roleForEmail(' LiorGra8@Gmail.com ', env), 'queen');
  assert.equal(roleForEmail('yogevabr@gmail.com', env), 'slave');
  assert.equal(roleForEmail('someone@gmail.com', env), null);
  assert.equal(roleForEmail('', env), null);
  assert.equal(roleForEmail(null, env), null);
  assert.equal(roleForEmail('x@y.z', {}), null);
});

test('points: full on time, half when late', () => {
  assert.deepEqual(approvalPoints('royal', 1000, 900), { points: 20, late: false });
  assert.deepEqual(approvalPoints('royal', 1000, 1100), { points: 10, late: true });
  assert.deepEqual(approvalPoints('request', 1000, 1100), { points: 2, late: true });
  assert.deepEqual(approvalPoints('command', null, 5), { points: 10, late: false });
});

test('overdue is derived from the deadline', () => {
  assert.equal(displayStatus({ status: 'open', deadline: 10 }, 20), 'overdue');
  assert.equal(displayStatus({ status: 'open', deadline: 30 }, 20), 'open');
  assert.equal(displayStatus({ status: 'submitted', deadline: 10 }, 20), 'submitted');
  assert.equal(displayStatus({ status: 'open', deadline: null }, 20), 'open');
});

test('pin format', () => {
  assert.ok(validPin('1234'));
  assert.ok(validPin('12345678'));
  assert.ok(!validPin('123'));
  assert.ok(!validPin('123456789'));
  assert.ok(!validPin('12a4'));
  assert.ok(!validPin(1234));
});

test('tokens expire when idle', () => {
  assert.ok(tokenAlive({ created: 0, last_seen: 0 }, 1000));
  assert.ok(!tokenAlive({ created: 0, last_seen: 0 }, TOKEN_IDLE_MS + 1));
  assert.ok(!tokenAlive(null, 0));
});

test('lockout after five wrong pins', () => {
  assert.equal(lockoutAfterFail(4, 0), 0);
  assert.equal(lockoutAfterFail(5, 0), 5 * 60 * 1000);
  assert.equal(lockoutAfterFail(6, 0), 10 * 60 * 1000);
});
