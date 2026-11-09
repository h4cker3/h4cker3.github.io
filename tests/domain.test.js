import test from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, validateTask, advance, rollWeek, stats, friendsOverview } from '../src/domain.js';
const task = (overrides = {}) => ({ id: 'one', title: 'Зал', difficulty: 3, mode: 'count', target: 3, progress: 1, week_start: '2026-11-02', origin_week: '2026-11-02', ...overrides });

test('Monday boundary is Moscow time even on Sunday UTC', () => {
  assert.equal(weekStart(new Date('2026-11-08T20:59:59Z')), '2026-11-02');
  assert.equal(weekStart(new Date('2026-11-08T21:00:00Z')), '2026-11-09');
  assert.equal(weekStart(new Date('2027-01-01T10:00:00Z')), '2026-12-28');
});
test('count and percentage increment without exceeding target', () => {
  assert.equal(advance(task()), 2);
  assert.equal(advance(task({ progress: 3 })), 3);
  assert.equal(advance(task({ mode: 'percent', target: 100, progress: 95 })), 100);
});
test('weighted difficulty counts tasks, not repetitions', () => {
  assert.deepEqual(stats([task(), task({ difficulty: 1, target: 20 }), task({ difficulty: 4, progress: 3 })]), {
    total: 3, done: 1, average: 8 / 3, distribution: [1, 0, 1, 1],
  });
  assert.equal(stats([]).average, 0);
});
test('rollover preserves old snapshot and partial progress, skips completed, is idempotent', () => {
  const previous = [task(), task({ id: 'done', progress: 3 })];
  const next = rollWeek(previous, '2026-11-09', () => 'two');
  assert.equal(next.length, 3);
  assert.equal(next[0].week_start, '2026-11-02');
  assert.equal(next[2].progress, 1);
  assert.equal(next[2].rolled_from, 'one');
  assert.deepEqual(rollWeek(next, '2026-11-09'), next);
  const later = rollWeek(next, '2026-11-23', () => 'three');
  assert.equal(later.length, 4);
  assert.equal(later[3].rolled_from, 'two');
  assert.equal(later[3].origin_week, '2026-11-02');
});
test('completed carried task does not resurrect its incomplete ancestor', () => {
  const tasks = [task(), task({ id: 'two', week_start: '2026-11-09', rolled_from: 'one', progress: 3 })];
  assert.equal(rollWeek(tasks, '2026-11-16').length, 2);
});
test('deleted carried task blocks resurrection and does not roll over', () => {
  const tasks = [task(), task({ id: 'two', week_start: '2026-11-09', rolled_from: 'one', deleted_at: '2026-11-10' })];
  assert.equal(rollWeek(tasks, '2026-11-16').length, 2);
});
test('validation rejects unsafe or impossible values and normalizes percentage target', () => {
  for (const patch of [{ title: ' ' }, { difficulty: 5 }, { target: 0 }, { target: 2.5 }, { progress: 4 }, { progress: -1 }, { mode: 'bad' }]) {
    assert.throws(() => validateTask(task(patch)));
  }
  assert.equal(validateTask(task({ mode: 'percent', target: 7, progress: 50 })).target, 100);
  assert.equal(validateTask(task({ title: '  Зал  ' })).title, 'Зал');
});

test('friends compare relative completion, omit finished tasks and keep only three', () => {
  const week = '2026-11-09';
  const items = [
    task({ id: 'repeated', owner_id: 'alex', week_start: week, target: 3, progress: 2 }),
    task({ id: 'percent', owner_id: 'alex', week_start: week, mode: 'percent', target: 100, progress: 80 }),
    task({ id: 'done', owner_id: 'alex', week_start: week, progress: 3 }),
    task({ id: 'zero', owner_id: 'alex', week_start: week, progress: 0 }),
    task({ id: 'half', owner_id: 'alex', week_start: week, target: 2, progress: 1 }),
  ];
  const [alex, empty] = friendsOverview([{ id: 'alex' }, { id: 'empty' }], items, week);
  assert.deepEqual(alex.closest.map((t) => t.id), ['percent', 'repeated', 'half']);
  assert.equal(alex.stats.total, 5);
  assert.equal(alex.stats.done, 1);
  assert.deepEqual(alex.tasks.map((t) => t.id), ['percent', 'repeated', 'half', 'zero', 'done']);
  assert.equal(alex.tasks.length, alex.stats.total);
  assert.deepEqual(items.map((t) => t.id), ['repeated', 'percent', 'done', 'zero', 'half']);
  assert.equal(empty.stats.total, 0);
  assert.deepEqual(empty.closest, []);
  assert.deepEqual(empty.tasks, []);
});
test('friends see carryover before owner logs in, without duplicates or resurrected deleted tasks', () => {
  const original = [
    task({ id: 'old', owner_id: 'alex' }),
    task({ id: 'current', owner_id: 'alex', week_start: '2026-11-09', rolled_from: 'old' }),
    task({ id: 'pending', owner_id: 'alex' }),
    task({ id: 'deleted-old', owner_id: 'alex' }),
    task({ id: 'deleted-child', owner_id: 'alex', week_start: '2026-11-09', rolled_from: 'deleted-old', deleted_at: '2026-11-10' }),
    task({ id: 'past-done', owner_id: 'alex', progress: 3 }),
  ];
  const [alex] = friendsOverview([{ id: 'alex' }], original, '2026-11-16');
  assert.equal(alex.stats.total, 2);
  assert.deepEqual(alex.closest.map((t) => t.rolled_from).sort(), ['current', 'pending']);
  assert.equal(original.length, 6);
  assert.equal(original[0].week_start, '2026-11-02');
});

test('expanded friend tasks include completed tasks for this week and exclude deleted, future and other owners', () => {
  const week = '2026-11-09';
  const items = [
    task({ id: 'done', owner_id: 'alex', week_start: week, progress: 3 }),
    task({ id: 'old-done', owner_id: 'alex', progress: 3 }),
    task({ id: 'carry', owner_id: 'alex' }),
    task({ id: 'deleted', owner_id: 'alex', week_start: week, deleted_at: week }),
    task({ id: 'future', owner_id: 'alex', week_start: '2026-11-16' }),
    task({ id: 'other', owner_id: 'masha', week_start: week }),
  ];
  const [alex] = friendsOverview([{ id: 'alex' }], items, week);
  assert.equal(alex.tasks.length, 2);
  assert.equal(alex.tasks[0].rolled_from, 'carry');
  assert.equal(alex.tasks[1].id, 'done');
  assert.equal(alex.stats.total, alex.tasks.length);
  assert.equal(alex.stats.done, 1);
  const [finished] = friendsOverview([{ id: 'alex' }], [items[0]], week);
  assert.deepEqual(finished.closest, []);
  assert.deepEqual(finished.tasks.map(t => t.id), ['done']);
});
