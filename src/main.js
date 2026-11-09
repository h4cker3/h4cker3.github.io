import './style.css';
import { LEVELS, stats, isDone, fraction, weekStart, friendsOverview } from './domain.js';
import { configured, supabase, signIn, LocalRepository, SupabaseRepository } from './repository.js';
import { ACCENTS, readAppearance, persistAppearance, applyAppearance, profileFromUser, avatarUrl, validColor } from './appearance.js';

const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  rhythm: '<path d="M5 16V9m7 11V4m7 12V9"/>',
  check: '<path d="m6 12 4 4 8-8"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="m8 12 3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m8 16 8-8M7 8h9v9"/>',
  edit: '<path d="m15 5 4 4M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  telegram: '<path d="m21 4-4 17-6-5-3 3 1-6 9-6-12 5-4-2z"/>',
  logout: '<path d="M9 4H5v16h4m5-13 5 5-5 5m-5-5h10"/>',
  back: '<path d="m14 7-5 5 5 5"/>',
  spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  friends: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 13.1A9 9 0 0 1 10.9 3.5a9 9 0 1 0 9.6 9.6z"/>',
}[name] || ''}</svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const app = document.querySelector('#app');
let repository, user, tasks = [], filter = 'all', busy = false, demo = !configured, currentWeek = weekStart();
let sheetReturnFocus;
let profile = {}, currentView = 'tasks', profileSaving = false;
const expandedFriends = new Set();
let friendsData = null, friendsLoading = false, friendsError = '', friendsWeek = weekStart(), friendsRequest = 0, friendsTimer;
let appearance = readAppearance('login');
applyAppearance(appearance);
const accountKey = () => demo ? 'demo' : user?.id || 'login';
const displayProfile = () => {
  const fromTelegram = profileFromUser(demo ? null : user);
  return { ...fromTelegram, ...profile, telegram_username: fromTelegram.telegram_username || profile.telegram_username, avatar_url: fromTelegram.avatar_url || profile.avatar_url };
};
function avatarMarkup(data = displayProfile()) {
  const url = avatarUrl(data.avatar_url);
  return `<span class="avatar-fallback">${esc([...(data.display_name || '')][0] || '?')}</span>${url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer" decoding="async">` : ''}`;
}
function wireAvatars() {
  document.querySelectorAll('.avatar img').forEach((image) => {
    if (image.dataset.bound) return;
    image.dataset.bound = 'true';
    const fail = () => {
      image.hidden = true;
      const note = image.closest('.friend-card') ? null : document.querySelector('#avatar-note');
      if (note) { note.hidden = false; note.textContent = 'Фото Telegram недоступно. Попробуй войти заново.'; }
    };
    image.addEventListener('error', fail);
    if (image.complete && !image.naturalWidth) fail();
  });
}
const fmt = (date, options) => new Intl.DateTimeFormat('ru', { timeZone: 'UTC', ...options }).format(date);
function weekLabel(week = currentWeek) {
  const start = new Date(`${week}T12:00:00Z`), end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${fmt(start, { day: 'numeric' })}${start.getUTCMonth() !== end.getUTCMonth() ? ` ${fmt(start, { month: 'short' })}` : ''} — ${fmt(end, { day: 'numeric', month: 'long' })}`;
}
function showToast(message) {
  const node = document.querySelector('#toast');
  if (!node) return;
  node.textContent = message; node.classList.add('visible');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => node.classList.remove('visible'), 4500);
}
function errorMessage(error) {
  console.error(error);
  return error?.message || 'Не удалось сохранить. Попробуй ещё раз.';
}
function shell() {
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="./" aria-label="Ритм, главная">${icon('rhythm')}<span>ритм<span class="brand-dot">.</span></span></a>
        <nav class="primary-nav" aria-label="Разделы приложения">
          <button class="nav-item" data-view="friends">${icon('friends')}<span>Друзья</span></button>
          <button class="nav-item" data-view="tasks">${icon('tasks')}<span>Задачи</span></button>
          <button class="nav-item" data-view="profile">${icon('user')}<span>Профиль</span></button>
        </nav>
        <button class="account" data-view="profile"><span class="avatar">${avatarMarkup()}</span><span class="account-name">${esc(displayProfile().display_name)}</span></button>
      </aside>
      <main>
        <header class="page-header"><h1 id="page-title">Моя неделя</h1><div class="week-badge"><span class="live-dot"></span>${weekLabel()}</div></header>
        ${demo ? '<div class="demo-banner"><span>Демо · данные в этом браузере</span></div>' : ''}
        <div id="tasks-view">
        <section class="overview" aria-label="Статистика недели" id="overview"></section>
        <section class="task-section" aria-label="Задачи недели">
          <div class="section-heading"><h2>Задачи <span id="task-count"></span></h2><button class="add-button" id="add">${icon('plus')}<span>Новая задача</span></button></div>
          <div class="list-toolbar"><div class="filters" role="group" aria-label="Фильтр задач"><button data-filter="all" aria-pressed="true">Все</button><button data-filter="open" aria-pressed="false">В процессе</button><button data-filter="done" aria-pressed="false">Готово</button></div></div>
          <div id="task-list"></div>
        </section>
        </div>
        <section id="friends-view" aria-label="Прогресс друзей" hidden></section>
        <section id="profile-view" aria-label="Настройки профиля" hidden></section>
      </main>
    </div>
    <dialog id="editor" aria-labelledby="editor-title"><div class="sheet-handle"></div><form id="task-form">
      <div class="sheet-heading"><h2 id="editor-title">Новая задача</h2><button type="button" class="icon-button" id="close-editor" aria-label="Закрыть редактор">${icon('close')}</button></div>
      <label class="field-label" for="title">Название</label><textarea id="title" name="title" rows="2" placeholder="Что хочешь сделать?" maxlength="180" required></textarea>
      <fieldset class="difficulty-field"><legend>Время-сложность</legend><div class="difficulty-options">${LEVELS.map((l) => `<label style="--level:${l.color}"><input type="radio" name="difficulty" value="${l.value}" ${l.value === 2 ? 'checked' : ''}><span><i></i>${l.label}</span></label>`).join('')}</div></fieldset>
      <fieldset class="mode-field"><legend>Как считаем прогресс</legend><div class="mode-options"><label><input type="radio" name="mode" value="count" checked><span>Количество <small>1 раз или несколько</small></span></label><label><input type="radio" name="mode" value="percent"><span>Проценты <small>От 0 до 100%</small></span></label></div></fieldset>
      <div class="number-fields"><div><label class="field-label" for="target">Цель за неделю</label><div class="number-input"><input id="target" name="target" type="number" min="1" max="999" value="1" step="1" required><span id="target-unit">раз</span></div></div><div><label class="field-label" for="progress">Уже выполнено</label><div class="number-input"><input id="progress" name="progress" type="number" min="0" max="1" value="0" step="1" required><span id="progress-unit">раз</span></div></div></div>
      <div class="progress-preview"><div id="editor-preview-fill"></div></div>
      <p id="form-error" role="alert"></p><div class="sheet-actions"><button type="button" class="delete-button" id="delete-task">${icon('trash')}<span>Удалить</span></button><button type="submit" class="save-button">Сохранить ${icon('check')}</button></div>
    </form></dialog>
    <div id="toast" role="status" aria-live="polite"></div>`;
  document.querySelector('#add').onclick = () => openEditor();
  document.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => switchView(button.dataset.view));
  document.querySelectorAll('[data-filter]').forEach((b) => b.onclick = () => { filter = b.dataset.filter; renderTasks(); });
  setupEditor();
  render();
  renderProfile();
  switchView(currentView, false);
  wireAvatars();
}
function switchView(view, scroll = true) {
  if (busy && scroll) return;
  currentView = ['tasks', 'friends', 'profile'].includes(view) ? view : 'tasks';
  if (scroll && currentView === 'tasks' && weekStart() !== currentWeek) {
    reloadWeek().catch((error) => showToast(errorMessage(error)));
    return;
  }
  document.querySelector('#tasks-view').hidden = currentView !== 'tasks';
  document.querySelector('#friends-view').hidden = currentView !== 'friends';
  document.querySelector('#profile-view').hidden = currentView !== 'profile';
  const pageTitle = { tasks: 'Моя неделя', friends: 'Друзья', profile: 'Профиль' }[currentView];
  document.querySelector('#page-title').textContent = pageTitle;
  const badge = document.querySelector('.week-badge');
  badge.hidden = currentView === 'profile';
  badge.innerHTML = `<span class="live-dot"></span>${weekLabel(currentView === 'friends' ? friendsWeek : currentWeek)}`;
  document.querySelectorAll('[data-view]').forEach((button) => {
    if (button.dataset.view === currentView) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.title = `Ритм · ${pageTitle}`;
  clearInterval(friendsTimer);
  if (currentView === 'friends') {
    renderFriends();
    loadFriends();
    friendsTimer = setInterval(() => { if (!document.hidden && currentView === 'friends') loadFriends(true); }, 30000);
  }
  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
}
function resetFriends() {
  expandedFriends.clear();
  friendsRequest++;
  clearInterval(friendsTimer);
  friendsData = null; friendsLoading = false; friendsError = ''; friendsWeek = weekStart();
}
async function loadFriends(quiet = false) {
  if (!repository || friendsLoading || currentView !== 'friends') return;
  const source = repository, request = ++friendsRequest;
  friendsLoading = true;
  if (!quiet || !friendsData) renderFriends();
  try {
    const data = await source.listFriends();
    if (request !== friendsRequest || source !== repository) return;
    friendsData = data; friendsWeek = weekStart(); friendsError = '';
  } catch (error) {
    if (request !== friendsRequest || source !== repository) return;
    friendsError = errorMessage(error);
  } finally {
    if (request === friendsRequest && source === repository) {
      friendsLoading = false;
      const restoreFocus = document.activeElement?.id === 'refresh-friends';
      const restoreFriend = document.activeElement?.dataset.friendToggle;
      if (document.querySelector('#friends-view')) renderFriends();
      if (restoreFocus) document.querySelector('#refresh-friends')?.focus({ preventScroll: true });
      if (restoreFriend) [...document.querySelectorAll('[data-friend-toggle]')].find((button) => button.dataset.friendToggle === restoreFriend)?.focus({ preventScroll: true });
      if (currentView === 'friends') document.querySelector('.week-badge').innerHTML = `<span class="live-dot"></span>${weekLabel(friendsWeek)}`;
    }
  }
}
function renderFriends() {
  const container = document.querySelector('#friends-view');
  if (!container) return;
  const ownId = demo ? 'demo' : user.id;
  const profiles = friendsData?.profiles.map((p) => p.id === ownId ? { ...p, ...displayProfile() } : p) || [];
  const members = friendsData ? friendsOverview(profiles, friendsData.tasks, friendsWeek).sort((a, b) =>
    Number(b.id === ownId) - Number(a.id === ownId) || a.display_name.localeCompare(b.display_name, 'ru') || a.id.localeCompare(b.id)
  ) : [];
  const totals = members.reduce((sum, member) => ({
    total: sum.total + member.stats.total,
    done: sum.done + member.stats.done,
    weighted: sum.weighted + member.stats.average * member.stats.total,
    distribution: sum.distribution.map((count, i) => count + member.stats.distribution[i]),
  }), { total: 0, done: 0, weighted: 0, distribution: [0, 0, 0, 0] });
  const max = Math.max(1, ...totals.distribution);
  const levels = totals.distribution[3] ? LEVELS : LEVELS.slice(0, 3);
  container.innerHTML = `
    <div class="friends-toolbar"><h2>Участники${friendsData ? ` <span class="member-count">${members.length}</span>` : ''}</h2><button class="icon-button" id="refresh-friends" aria-label="Обновить прогресс друзей" ${friendsLoading ? 'disabled' : ''}>${icon('refresh', friendsLoading ? 'is-loading' : '')}</button></div>
    ${friendsError ? `<div class="friends-error" role="alert"><span>${friendsData ? 'Не удалось обновить. Показаны последние загруженные данные.' : 'Не удалось загрузить участников.'}</span><p>${esc(friendsError)}</p><button class="text-button" id="retry-friends">Повторить</button></div>` : ''}
    ${!friendsData && friendsLoading ? '<div class="friends-loading" role="status">Загружаем участников…</div>' : ''}
    ${friendsData && !members.length ? `<div class="empty-state">${icon('friends')}<h3>Пока нет участников</h3><p>Они появятся здесь после входа в приложение.</p></div>` : ''}
    <div class="friends-grid">${members.map((member, index) => {
      const color = validColor(member.accent_color) ? member.accent_color : appearance.accent;
      const percentage = member.stats.total ? Math.round(member.stats.done / member.stats.total * 100) : 0;
      return `<article class="friend-card" style="--friend-accent:${color}" aria-label="${esc(member.display_name)}: ${member.stats.done} из ${member.stats.total} задач выполнено">
        <div class="friend-heading"><div class="avatar">${avatarMarkup(member)}</div><div class="friend-identity"><h3>${esc(member.display_name)}${member.id === ownId ? '<span class="you-badge">Ты</span>' : ''}</h3>${member.telegram_username ? `<span>@${esc(member.telegram_username.replace(/^@/, ''))}</span>` : ''}</div><div class="friend-score"><strong>${member.stats.done}</strong><span>/${member.stats.total}</span></div></div>
        <div class="friend-progress" role="progressbar" aria-label="Выполнено задач за неделю" aria-valuemin="0" aria-valuemax="${member.stats.total || 1}" aria-valuenow="${member.stats.done}" aria-valuetext="${member.stats.done} из ${member.stats.total}"><span style="width:${percentage}%"></span></div>
        <div class="friend-task-panel">${friendTaskPanel(member, index)}</div>
      </article>`;
    }).join('')}</div>
    ${members.length ? `<section class="friends-breakdown" aria-label="Общая статистика участников"><div class="friends-breakdown-heading"><div><h2>Общая неделя</h2><p>${totals.done} из ${totals.total} задач выполнено</p></div><span class="friends-average">${totals.total ? (totals.weighted / totals.total).toFixed(1) : '—'}<small>средняя сложность</small></span></div><div class="chart" role="img" aria-label="${LEVELS.map((l, i) => `${l.label}: ${totals.distribution[i]}`).join(', ')}">${levels.map((level, i) => `<div class="chart-col" style="--level:${level.color};--bar-height:${totals.distribution[i] / max * 72}%"><div class="bar-space">${totals.distribution[i] ? `<span>${totals.distribution[i]}</span><div class="bar"></div>` : ''}</div><span class="chart-label">${level.label}</span></div>`).join('')}</div></section>` : ''}`;
  container.onclick = (event) => {
    const button = event.target.closest('[data-friend-toggle]');
    if (!button || !container.contains(button)) return;
    const index = members.findIndex((member) => member.id === button.dataset.friendToggle);
    if (index < 0) return;
    const member = members[index];
    if (expandedFriends.has(member.id)) expandedFriends.delete(member.id);
    else expandedFriends.add(member.id);
    const panel = button.closest('.friend-task-panel');
    panel.innerHTML = friendTaskPanel(member, index);
    panel.querySelector('.friend-toggle').focus({ preventScroll: true });
  };
  document.querySelector('#refresh-friends').onclick = () => loadFriends();
  document.querySelector('#retry-friends')?.addEventListener('click', () => loadFriends());
  wireAvatars();
}
function friendTaskPanel(member, index) {
  const expanded = expandedFriends.has(member.id);
  const visible = expanded ? member.tasks : member.closest;
  return `${visible.length ? `<ul id="friend-tasks-${index}" class="friend-tasks" aria-label="${expanded ? 'Все задачи недели' : 'Ближайшие к завершению задачи'}">${visible.map((task) => {
    const level = LEVELS[task.difficulty - 1], done = isDone(task);
    const progress = task.mode === 'percent' ? `${task.progress}<small>%</small>` : task.target === 1 ? done ? icon('check') : '<span class="empty-check"></span>' : `${task.progress}<small>/${task.target}</small>`;
    return `<li class="${done ? 'friend-task-done' : ''}" style="--level:${level.color}"><span class="friend-task-name">${esc(task.title)}</span><span class="progress-button friend-task-progress ${done ? 'filled' : ''}" role="img" aria-label="${task.progress} из ${task.target}${task.mode === 'percent' ? ' процентов' : ''}${done ? ', выполнено' : ''}"><span class="progress-fill" style="height:${fraction(task) * 100}%"></span><span class="progress-value">${progress}</span></span></li>`;
  }).join('')}</ul>` : `<div id="friend-tasks-${index}" class="friend-empty">${member.stats.total ? `${icon('check')}<span>Все задачи выполнены</span>` : '<span>Нет задач на эту неделю</span>'}</div>`}
  ${member.stats.total ? `<button type="button" class="friend-toggle" data-friend-toggle="${esc(member.id)}" aria-expanded="${expanded}" aria-controls="friend-tasks-${index}"><span>${expanded ? 'Свернуть' : `Все задачи · ${member.stats.total}`}</span>${icon('back')}</button>` : ''}`;
}
function renderProfile() {
  const data = displayProfile();
  document.querySelector('#profile-view').innerHTML = `
    <div class="identity-card"><div class="avatar profile-avatar">${avatarMarkup()}</div><div class="identity-text"><h2 id="profile-name">${esc(data.display_name)}</h2><span>${demo ? 'Демо-профиль' : data.telegram_username ? `@${esc(data.telegram_username.replace(/^@/, ''))}` : 'Telegram'}</span></div>${icon('telegram')}</div>
    <p id="avatar-note" class="profile-note" ${demo || avatarUrl(data.avatar_url || profileFromUser(user).avatar_url) ? 'hidden' : ''}>Telegram не передал фото. Войди заново с разрешением на профиль.</p>
    <form id="name-form" class="settings-card"><label class="field-label" for="display-name">Отображаемое имя</label><div class="name-input-row"><input id="display-name" name="display_name" value="${esc(data.display_name)}" maxlength="80" autocomplete="nickname" required><button class="save-button" type="submit" aria-label="Сохранить имя">${icon('check')}<span>Сохранить</span></button></div><p id="profile-error" role="alert" hidden></p></form>
    <section class="settings-card appearance-card" aria-labelledby="appearance-title"><h2 id="appearance-title">Оформление</h2>
      <div class="setting-group"><span class="field-label" id="theme-label">Тема</span><div class="theme-options" role="group" aria-labelledby="theme-label"><button type="button" data-theme-choice="light" aria-pressed="${appearance.theme === 'light'}">${icon('sun')}Светлая</button><button type="button" data-theme-choice="dark" aria-pressed="${appearance.theme === 'dark'}">${icon('moon')}Тёмная</button></div></div>
      <div class="setting-group"><span class="field-label" id="accent-label">Акцентный цвет</span><div class="accent-options" role="group" aria-labelledby="accent-label">${ACCENTS.map((accent) => `<button type="button" class="accent-swatch" style="--swatch:${accent.color}" data-accent="${accent.color}" aria-label="${accent.name}" aria-pressed="${appearance.accent.toLowerCase() === accent.color}" title="${accent.name}">${icon('check')}</button>`).join('')}</div><label class="custom-color">Свой цвет <span class="custom-color-value">${esc(appearance.accent.toUpperCase())}</span><input type="color" id="custom-accent" aria-label="Свой акцентный цвет" value="${appearance.accent}"></label></div>
    </section>
    <button class="logout-button" id="logout">${icon('logout')}<span>${demo ? 'Выйти из демо' : 'Выйти из аккаунта'}</span></button>`;
  document.querySelector('#name-form').onsubmit = async (event) => {
    event.preventDefault();
    if (profileSaving) return;
    const name = document.querySelector('#display-name').value;
    await saveProfile({ display_name: name });
  };
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.onclick = () => {
    const previous = { ...appearance };
    appearance.theme = button.dataset.themeChoice;
    try { persistAppearance(appearance, accountKey()); }
    catch (e) { appearance = previous; showToast('Не удалось сохранить тему в браузере.'); return; }
    applyAppearance(appearance);
    document.querySelectorAll('[data-theme-choice]').forEach((node) => node.setAttribute('aria-pressed', node.dataset.themeChoice === appearance.theme));
  });
  document.querySelectorAll('[data-accent]').forEach((button) => button.onclick = () => saveProfile({ accent_color: button.dataset.accent }));
  document.querySelector('#custom-accent').addEventListener('input', (event) => {
    applyAppearance({ ...appearance, accent: event.target.value });
    document.querySelector('.custom-color-value').textContent = event.target.value.toUpperCase();
  });
  document.querySelector('#custom-accent').addEventListener('change', (event) => saveProfile({ accent_color: event.target.value }));
  document.querySelector('#logout').onclick = logout;
  wireAvatars();
}
async function saveProfile(input) {
  if (profileSaving) return;
  profileSaving = true;
  const errorNode = document.querySelector('#profile-error');
  errorNode.hidden = true;
  const controls = document.querySelectorAll('#name-form button, #name-form input, [data-accent], #custom-accent, #logout');
  controls.forEach((control) => { control.disabled = true; });
  try {
    profile = await repository.saveProfile(input);
    if (validColor(profile.accent_color)) appearance.accent = profile.accent_color;
    applyAppearance(appearance);
    try { persistAppearance(appearance, accountKey()); }
    catch { showToast('Профиль сохранён. Браузер не разрешил сохранить настройки на устройстве.'); }
    renderProfile();
    const account = document.querySelector('.account');
    account.querySelector('.account-name').textContent = displayProfile().display_name;
    account.querySelector('.avatar').innerHTML = avatarMarkup();
    wireAvatars();
    const focusTarget = input.display_name !== undefined ? document.querySelector('#display-name')
      : document.querySelector(`[data-accent="${appearance.accent}"]`) || document.querySelector('#custom-accent');
    focusTarget?.focus({ preventScroll: true });
    showToast(input.display_name !== undefined ? 'Имя сохранено' : 'Цвет сохранён');
  } catch (e) {
    applyAppearance(appearance);
    document.querySelector('#custom-accent').value = appearance.accent;
    document.querySelector('.custom-color-value').textContent = appearance.accent.toUpperCase();
    errorNode.hidden = false; errorNode.textContent = errorMessage(e);
    showToast('Изменения не сохранены. Попробуй ещё раз.');
  } finally {
    profileSaving = false;
    controls.forEach((control) => { control.disabled = false; });
  }
}
async function logout() {
  if (profileSaving || busy) return;
  const button = document.querySelector('#logout');
  button.disabled = true;
  try {
    if (!demo) { const { error } = await supabase.auth.signOut(); if (error) throw error; }
    resetFriends();
    repository = null; tasks = []; profile = {}; user = null; currentView = 'tasks'; filter = 'all';
    loginScreen();
  } catch (e) { showToast(errorMessage(e)); button.disabled = false; }
}
function render() { renderOverview(); renderTasks(); }
function renderOverview() {
  const s = stats(tasks), percentage = s.total ? Math.round(s.done / s.total * 100) : 0;
  const max = Math.max(1, ...s.distribution);
  const levels = s.distribution[3] ? LEVELS : LEVELS.slice(0, 3);
  document.querySelector('#overview').innerHTML = `
    <div class="stat-card completion-card"><div class="card-top"><span>На этой неделе</span>${icon('arrow')}</div><div class="big-number">${s.done}<span>/ ${s.total}</span></div><div class="card-bottom"><span>задач выполнено</span><strong>${percentage}%</strong></div><div class="completion-track"><div style="width:${percentage}%"></div></div></div>
    <div class="stat-card difficulty-card"><div class="card-top"><span>Время-сложность</span>${icon('rhythm')}</div><div class="average"><strong>${s.average ? s.average.toFixed(1) : '—'}</strong><span>средняя<br>сложность</span></div><div class="chart" role="img" aria-label="${LEVELS.map((l,i) => `${l.label}: ${s.distribution[i]}`).join(', ')}">${levels.map((l, i) => `<div class="chart-col" style="--level:${l.color};--bar-height:${s.distribution[i] / max * 72}%"><div class="bar-space">${s.distribution[i] ? `<span>${s.distribution[i]}</span><div class="bar"></div>` : ''}</div><span class="chart-label">${l.label}</span></div>`).join('')}</div></div>`;
}
function renderTasks() {
  document.querySelector('#task-count').textContent = tasks.length;
  document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === filter));
  const visible = tasks.filter((t) => filter === 'all' || (filter === 'done' ? isDone(t) : !isDone(t)));
  const sorted = [...visible.filter((t) => !isDone(t)), ...visible.filter(isDone)];
  const list = document.querySelector('#task-list');
  list.innerHTML = sorted.length ? sorted.map((t, i) => {
    const level = LEVELS[t.difficulty - 1], done = isDone(t);
    const caption = t.mode === 'percent' ? `${t.progress}%` : t.target === 1 ? done ? 'Выполнено' : 'Один раз за неделю' : `${t.progress} из ${t.target} за неделю`;
    const text = t.mode === 'percent' ? `${t.progress}<small>%</small>` : t.target === 1 ? done ? icon('check') : '<span class="empty-check"></span>' : `${t.progress}<small>/${t.target}</small>`;
    return `<article class="task-row ${done ? 'is-done' : ''}" data-id="${t.id}" style="--level:${level.color};--row:${i}"><div class="task-info"><div class="task-title">${esc(t.title)}</div><div class="task-meta"><span class="level-tag"><i></i>${level.label}</span><span class="meta-dot">·</span><span>${caption}</span>${t.origin_week < currentWeek ? '<span class="carried-tag">↗ с прошлой недели</span>' : ''}</div></div><button class="edit-task icon-button" aria-label="Изменить: ${esc(t.title)}">${icon('edit')}</button><button class="progress-button ${done ? 'filled' : ''}" ${busy ? 'disabled' : ''} aria-label="${esc(t.title)}: ${t.progress} из ${t.target}. ${done ? 'Выполнено' : t.mode === 'percent' ? 'Добавить 10 процентов' : 'Добавить одно выполнение'}" aria-disabled="${done}"><span class="progress-fill" style="height:${fraction(t) * 100}%"></span><span class="progress-value">${text}</span></button></article>`;
  }).join('') : `<div class="empty-state">${icon(filter === 'done' ? 'check' : 'spark')}<h3>${filter === 'done' ? 'Нет выполненных задач' : filter === 'open' ? 'Все задачи выполнены' : 'Нет задач'}</h3><p>${filter === 'done' ? 'Выполненные задачи появятся здесь.' : filter === 'open' ? 'Незавершённых задач нет.' : 'Добавь задачу на эту неделю.'}</p>${filter === 'all' ? '<button class="text-button" id="empty-add">Добавить задачу ↗</button>' : ''}</div>`;
  document.querySelector('#empty-add')?.addEventListener('click', () => openEditor());
  list.querySelectorAll('.task-row').forEach((row) => {
    const task = tasks.find((t) => t.id === row.dataset.id);
    row.querySelector('.edit-task').onclick = () => openEditor(task);
    row.querySelector('.progress-button').onclick = () => increment(task);
    let timer, start;
    const cancel = () => { clearTimeout(timer); timer = null; };
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      start = [e.clientX, e.clientY];
      timer = setTimeout(() => { timer = null; openEditor(task); }, 520);
    });
    row.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) cancel(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((name) => row.addEventListener(name, cancel));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); });
  });
}
async function increment(task) {
  if (busy || isDone(task)) return;
  busy = true;
  const focusedId = task.id;
  renderTasks();
  try {
    if (weekStart() !== currentWeek) { await reloadWeek(); showToast('Началась новая неделя. Список обновлён.'); return; }
    const next = await repository.increment(task);
    tasks = tasks.map((t) => t.id === task.id ? next : t);
    if (isDone(next)) showToast('Задача выполнена');
  } catch (e) { showToast(errorMessage(e)); }
  finally { busy = false; render(); document.querySelector(`[data-id="${focusedId}"] .progress-button`)?.focus({ preventScroll: true }); }
}
function openEditor(task) {
  if (busy) return;
  sheetReturnFocus = document.activeElement;
  const form = document.querySelector('#task-form');
  form.reset(); form.dataset.id = task?.id || '';
  document.querySelector('#editor-title').textContent = task ? 'Изменить задачу' : 'Новая задача';
  form.elements.title.value = task?.title || '';
  form.elements.mode.value = task?.mode || 'count';
  form.elements.difficulty.value = String(task?.difficulty || 2);
  form.elements.target.value = task?.target || 1;
  form.elements.progress.value = task?.progress || 0;
  document.querySelector('#form-error').textContent = '';
  document.querySelector('#delete-task').hidden = !task;
  document.querySelector('#delete-task').dataset.armed = '';
  document.querySelector('#delete-task span').textContent = 'Удалить';
  updateEditor();
  document.querySelector('#editor').showModal();
  document.querySelector('#title').focus();
}
function updateEditor() {
  const form = document.querySelector('#task-form'), percent = form.elements.mode.value === 'percent';
  form.elements.target.readOnly = percent;
  if (percent) form.elements.target.value = 100;
  const target = Number(form.elements.target.value);
  form.elements.progress.max = target;
  document.querySelector('#target-unit').textContent = percent ? '%' : 'раз';
  document.querySelector('#progress-unit').textContent = percent ? '%' : 'раз';
  const fill = document.querySelector('#editor-preview-fill');
  fill.style.width = `${Math.min(100, Math.max(0, Number(form.elements.progress.value) / target * 100)) || 0}%`;
  fill.style.background = LEVELS[Number(form.elements.difficulty.value) - 1].color;
}
function setupEditor() {
  const dialog = document.querySelector('#editor'), form = document.querySelector('#task-form');
  const close = () => { if (!busy) dialog.close(); };
  document.querySelector('#close-editor').onclick = close;
  dialog.addEventListener('click', (e) => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });
  dialog.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });
  dialog.addEventListener('close', () => sheetReturnFocus?.isConnected && sheetReturnFocus.focus());
  form.addEventListener('input', updateEditor);
  form.addEventListener('change', (e) => {
    if (e.target.name === 'mode' && e.target.value === 'count') {
      form.elements.target.value = 1; form.elements.progress.value = 0;
    }
    updateEditor();
  });
  const disable = (value) => form.querySelectorAll('button, input, textarea').forEach((n) => { n.disabled = value; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (busy) return;
    const input = Object.fromEntries(new FormData(form));
    busy = true; disable(true);
    try {
      if (weekStart() !== currentWeek) { await reloadWeek(); throw new Error('Началась новая неделя. Закрой редактор и открой задачу заново.'); }
      const next = await repository.save(input, form.dataset.id || undefined);
      tasks = form.dataset.id ? tasks.map((t) => t.id === next.id ? next : t) : [...tasks, next];
      dialog.close(); render(); showToast('Задача сохранена');
    } catch (err) { document.querySelector('#form-error').textContent = errorMessage(err); }
    finally { busy = false; disable(false); renderTasks(); }
  });
  document.querySelector('#delete-task').onclick = async () => {
    const button = document.querySelector('#delete-task');
    if (busy) return;
    if (!button.dataset.armed) { button.dataset.armed = 'yes'; button.querySelector('span').textContent = 'Точно удалить?'; return; }
    busy = true; disable(true);
    try { await repository.remove(form.dataset.id); tasks = tasks.filter((t) => t.id !== form.dataset.id); dialog.close(); render(); showToast('Задача удалена'); }
    catch (err) { document.querySelector('#form-error').textContent = errorMessage(err); }
    finally { busy = false; disable(false); renderTasks(); }
  };
}
async function reloadWeek() { tasks = await repository.list(); currentWeek = weekStart(); shell(); }
function loginScreen() {
  document.title = 'Ритм · Вход';
  app.innerHTML = `<div class="login-screen"><a class="brand" href="./">${icon('rhythm')}<span>ритм.</span></a><div class="login-card"><h1>Вход в Ритм</h1><button id="telegram-login" class="save-button" ${configured ? '' : 'disabled'}>${icon('telegram')} Войти через Telegram</button><button id="try-demo" class="text-button">Открыть демо</button><p id="login-error" role="alert"></p></div></div>`;
  document.querySelector('#telegram-login').onclick = attemptLogin;
  document.querySelector('#try-demo').onclick = async () => { demo = true; await start(); };
}
async function attemptLogin() {
  try { await signIn(); }
  catch (e) {
    const node = document.querySelector('#login-error');
    if (node) node.textContent = errorMessage(e); else showToast(errorMessage(e));
  }
}
async function start() {
  try {
    resetFriends();
    appearance = readAppearance(accountKey());
    applyAppearance(appearance);
    repository = demo ? new LocalRepository() : new SupabaseRepository(user.id);
    [tasks, profile] = await Promise.all([repository.list(), repository.getProfile()]);
    if (validColor(profile.accent_color)) appearance.accent = profile.accent_color;
    applyAppearance(appearance);
    currentWeek = weekStart(); shell();
  } catch (e) {
    app.innerHTML = `<div class="startup-error"><h1>Не удалось открыть задачи</h1><p>${esc(errorMessage(e))}</p><p>Проверь подключение и настройку базы данных.</p><button class="save-button" id="retry">Попробовать снова</button></div>`;
    document.querySelector('#retry').onclick = start;
  }
}
async function init() {
  if (configured) {
    const { data, error } = await supabase.auth.getSession();
    if (error) { loginScreen(); document.querySelector('#login-error').textContent = errorMessage(error); return; }
    user = data.session?.user;
    // Remove the one-use authorization code and any auth errors from browser history.
    if (new URLSearchParams(location.search).has('code')) history.replaceState({}, '', location.pathname);
    if (!user) { loginScreen(); return; }
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && !demo) { resetFriends(); repository = null; user = null; tasks = []; profile = {}; currentView = 'tasks'; loginScreen(); }
      if (event === 'TOKEN_REFRESHED') user = session?.user;
    });
  }
  await start();
}
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && repository && currentView === 'friends') loadFriends(true);
  if (!document.hidden && repository && !busy && !profileSaving && currentView === 'tasks' && !document.querySelector('#editor')?.open && weekStart() !== currentWeek) {
    try { await reloadWeek(); } catch (e) { showToast(errorMessage(e)); }
  }
});
await init();
