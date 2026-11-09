export const LEVELS = [
  { value: 1, label: 'Легко', color: '#b7dfc6', note: 'Небольшой шаг' },
  { value: 2, label: 'Средне', color: '#edcf87', note: 'Нужно собраться' },
  { value: 3, label: 'Сложно', color: '#eea39d', note: 'Серьёзный вызов' },
  { value: 4, label: 'Ультра', color: '#c5ace9', note: 'За пределами привычного' },
];

// One shared week boundary for every friend and for PostgreSQL: Monday, Moscow.
export function weekStart(date = new Date()) {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const d = new Date(`${local}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}

export function validateTask(input) {
  const title = String(input.title ?? '').trim();
  if (!title || title.length > 180) throw new Error('Название: от 1 до 180 символов.');
  const difficulty = Number(input.difficulty);
  if (![1, 2, 3, 4].includes(difficulty)) throw new Error('Выбери время-сложность.');
  if (!['count', 'percent'].includes(input.mode)) throw new Error('Выбери тип выполнения.');
  const target = input.mode === 'percent' ? 100 : Number(input.target);
  const progress = Number(input.progress);
  if (!Number.isInteger(target) || target < 1 || target > 999) throw new Error('Цель: целое число от 1 до 999.');
  if (!Number.isInteger(progress) || progress < 0 || progress > target) throw new Error(`Прогресс: целое число от 0 до ${target}.`);
  return { title, difficulty, mode: input.mode, target, progress };
}

export const isDone = (task) => task.progress >= task.target;
export const fraction = (task) => Math.min(1, Math.max(0, task.progress / task.target));
export const advance = (task) => Math.min(task.target, task.progress + (task.mode === 'percent' ? 10 : 1));
export function stats(tasks) {
  return {
    total: tasks.length,
    done: tasks.filter(isDone).length,
    average: tasks.length ? tasks.reduce((sum, t) => sum + t.difficulty, 0) / tasks.length : 0,
    distribution: LEVELS.map((l) => tasks.filter((t) => t.difficulty === l.value).length),
  };
}

export function rollWeek(tasks, week, makeId = () => crypto.randomUUID()) {
  const parents = new Set(tasks.map((t) => t.rolled_from).filter(Boolean));
  const carried = tasks.filter((t) => t.week_start < week && !t.deleted_at && !isDone(t) && !parents.has(t.id))
    .map((t) => ({ ...t, id: makeId(), week_start: week, rolled_from: t.id, origin_week: t.origin_week ?? t.week_start }));
  return [...tasks, ...carried];
}

// Project unfinished leaf tasks into this week without writing another user's rows.
// Include tombstones in the source: a deleted child must block its old ancestor.
export function friendsOverview(profiles, tasks, week) {
  let virtualId = 0;
  const current = rollWeek(tasks, week, () => `projected-${virtualId++}`)
    .filter((task) => task.week_start === week && !task.deleted_at);
  const byOwner = new Map();
  for (const task of current) {
    if (!byOwner.has(task.owner_id)) byOwner.set(task.owner_id, []);
    byOwner.get(task.owner_id).push(task);
  }
  return profiles.map((profile) => {
    const ownTasks = byOwner.get(profile.id) || [];
    const orderedTasks = [...ownTasks].sort((a, b) =>
      Number(isDone(a)) - Number(isDone(b)) || fraction(b) - fraction(a)
      || (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id)
    );
    const closest = orderedTasks.filter((task) => !isDone(task)).slice(0, 3);
    return { ...profile, stats: stats(ownTasks), closest, tasks: orderedTasks };
  });
}

export function demoFriends(week) {
  const profiles = [
    { id: 'demo-alex', display_name: 'Саша', telegram_username: 'alex_demo', accent_color: '#adcfee' },
    { id: 'demo-masha', display_name: 'Маша', telegram_username: 'masha_demo', accent_color: '#edb7ce' },
    { id: 'demo-nikita', display_name: 'Никита', telegram_username: 'nikita_demo', accent_color: '#edcf87' },
  ];
  const entries = [
    ['demo-alex', 'Подготовить портфолио', 3, 'percent', 100, 80],
    ['demo-alex', 'Пробежать 5 км', 2, 'count', 3, 2],
    ['demo-alex', 'Посмотреть лекции', 2, 'count', 4, 1],
    ['demo-alex', 'Разобрать почту', 1, 'count', 1, 1],
    ['demo-masha', 'Закончить иллюстрацию', 4, 'percent', 100, 90],
    ['demo-masha', 'Заниматься английским', 2, 'count', 5, 4],
    ['demo-masha', 'Приготовить новый рецепт', 1, 'count', 1, 1],
    ['demo-masha', 'Записаться на курс', 1, 'count', 1, 1],
    ['demo-nikita', 'Прочитать главу', 1, 'count', 1, 1],
    ['demo-nikita', 'Сдать проект', 3, 'percent', 100, 100],
  ];
  return { profiles, tasks: entries.map(([owner_id, title, difficulty, mode, target, progress], i) => ({
    id: `demo-friend-task-${i}`, owner_id, title, difficulty, mode, target, progress,
    week_start: week, origin_week: week, created_at: new Date().toISOString(),
  })) };
}

export function demoTasks(week) {
  return [
    ['Сходить на тренировку', 3, 'count', 3, 1],
    ['Дочитать «Атомные привычки»', 2, 'percent', 100, 60],
    ['Собрать первый прототип', 4, 'percent', 100, 30],
    ['Прогуляться без телефона', 1, 'count', 4, 2],
    ['Разобрать рабочий стол', 1, 'count', 1, 1],
    ['Записаться к стоматологу', 2, 'count', 1, 1],
    ['Позвонить родителям', 1, 'count', 1, 1],
  ].map(([title, difficulty, mode, target, progress]) => ({
    id: crypto.randomUUID(), title, difficulty, mode, target, progress,
    week_start: week, origin_week: week, owner_id: 'demo', created_at: new Date().toISOString(),
  }));
}
