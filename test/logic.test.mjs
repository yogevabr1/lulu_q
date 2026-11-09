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

import { localToUtc, tzParts, ritualDue, validTime } from '../src/logic.js';

test('Israel time conversion, winter and summer', () => {
  // 9 Nov 2026 is winter time (UTC+2); 1 Jul 2026 is summer time (UTC+3).
  assert.equal(new Date(localToUtc(2026, 11, 9, 20, 0)).toISOString(), '2026-11-09T18:00:00.000Z');
  assert.equal(new Date(localToUtc(2026, 7, 1, 20, 0)).toISOString(), '2026-07-01T17:00:00.000Z');
  const p = tzParts(Date.parse('2026-11-09T22:30:00Z')); // 00:30 on Tuesday local
  assert.deepEqual([p.d, p.h, p.mi, p.wd], [10, 0, 30, 2]);
});

test('rituals are created once a day, before their time, on the right weekday', () => {
  const morning = Date.parse('2026-11-10T04:00:00Z'); // Tue 06:00 local
  const daily = { active: 1, freq: 'daily', time: '07:30', last_key: null };
  const due = ritualDue(daily, morning);
  assert.equal(due.key, '2026-11-10');
  assert.equal(new Date(due.deadline).toISOString(), '2026-11-10T05:30:00.000Z');
  assert.equal(ritualDue({ ...daily, last_key: '2026-11-10' }, morning), null);
  assert.equal(ritualDue({ ...daily, time: '05:00' }, morning), null); // already passed
  assert.equal(ritualDue({ ...daily, active: 0 }, morning), null);
  assert.ok(ritualDue({ active: 1, freq: 'weekly', weekday: 2, time: '21:00' }, morning));
  assert.equal(ritualDue({ active: 1, freq: 'weekly', weekday: 3, time: '21:00' }, morning), null);
  assert.ok(validTime('07:30') && !validTime('7:30') && !validTime('24:00'));
});
