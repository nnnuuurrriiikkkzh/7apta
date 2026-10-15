/* DummyJSON simulates writes. Keep successful edits as a local overlay so
   refreshing GET /todos does not discard the user's work. */
'use strict';
const API = 'https://dummyjson.com';
const STORAGE_KEY = 'delo-dummyjson-v1';
const $ = (selector) => document.querySelector(selector);
const emptyState = () => ({ changes: {}, deleted: [], created: [], cache: [] });
let local = emptyState();
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved && typeof saved.changes === 'object' && saved.changes !== null && !Array.isArray(saved.changes) && Array.isArray(saved.deleted) && Array.isArray(saved.created) && Array.isArray(saved.cache)) {
    local = saved;
  }
} catch { /* Private browsing or invalid storage: continue with API data. */ }
const validTodo = (task) => task && (typeof task.id === 'number' || typeof task.id === 'string') && typeof task.todo === 'string' && typeof task.completed === 'boolean';
local.cache = local.cache.filter(validTodo);
local.created = local.created.filter(validTodo);
let baseTasks = local.cache;
let filter = 'all';
let query = '';
let loading = true;
let editingId = null;
let saving = false;
let toastTimer;
let undoAction = null;
const pending = new Set();

function tasks() {
  return [...local.created, ...baseTasks.map(task => ({ ...task, ...local.changes[task.id] }))]
    .filter(task => !local.deleted.includes(task.id));
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(local)); }
  catch { showToast('Браузер не разрешил сохранение. Изменения доступны до закрытия страницы.'); }
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}

function showToast(message, action) {
  clearTimeout(toastTimer);
  const toast = $('#toast');
  toast.replaceChildren(document.createTextNode(message));
  undoAction = action || null;
  if (action) {
    const button = document.createElement('button');
    button.textContent = 'Отменить';
    button.addEventListener('click', () => {
      const undo = undoAction;
      undoAction = null;
      toast.hidden = true;
      if (undo) undo();
    });
    toast.append(button);
  }
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; undoAction = null; }, action ? 9000 : 5000);
}

async function request(path, method = 'GET', body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(API + path, {
      method,
      signal: controller.signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Сервер вернул ошибку ${response.status}. Попробуй ещё раз.`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('API не ответил за 15 секунд. Попробуй ещё раз.');
    if (error instanceof TypeError) throw new Error('Нет связи с DummyJSON. Проверь интернет и попробуй ещё раз.');
    throw error;
  } finally { clearTimeout(timer); }
}

function updateStats(all) {
  const done = all.filter(task => task.completed).length;
  const counts = { all: all.length, done, active: all.length - done };
  $('#total').textContent = counts.all;
  $('#active-count').textContent = counts.active;
  $('#done-count').textContent = done;
  document.querySelectorAll('[data-count]').forEach(el => { el.textContent = counts[el.dataset.count]; });
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.filter === filter);
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  });
  const percent = all.length ? Math.round(done / all.length * 100) : 0;
  $('#percent').replaceChildren(document.createTextNode(percent), Object.assign(document.createElement('span'), { textContent: '%' }));
  $('#ring').style.background = `conic-gradient(#5c9b76 ${percent * 3.6}deg, #dfebdf 0deg)`;
  $('#progress-bar').style.width = `${percent}%`;
  $('#progress-fraction').textContent = `${done} из ${all.length}`;
  $('#progress-copy').textContent = !all.length ? 'Самое время начать с первого дела' : percent === 100 ? 'Все дела сделаны. Можно выдохнуть!' : done ? 'Хороший темп. Продолжай в том же духе!' : 'Первый шаг — уже хорошее начало';
}

function makeRow(task) {
  const row = document.createElement('div');
  row.className = `task-row${task.completed ? ' is-done' : ''}`;
  row.dataset.id = task.id;
  const main = document.createElement('div');
  main.className = 'task-main';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.completed;
  checkbox.disabled = pending.has(task.id);
  checkbox.setAttribute('aria-label', `${task.completed ? 'Вернуть в работу' : 'Выполнить'}: ${task.todo}`);
  checkbox.addEventListener('change', () => changeTask(task, { completed: !task.completed }));
  const copy = document.createElement('div');
  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.todo;
  const subtitle = document.createElement('span');
  subtitle.className = 'task-subtitle';
  subtitle.textContent = typeof task.id === 'number' ? `DUMMYJSON · #${task.id}` : 'МОЯ ЗАДАЧА';
  copy.append(title, subtitle);
  main.append(checkbox, copy);
  const status = document.createElement('span');
  status.className = `status${task.completed ? ' done' : ''}`;
  status.textContent = task.completed ? 'Выполнено' : 'В работе';
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  for (const [name, label, handler] of [
    ['edit', 'Изменить', () => openDialog(task)],
    ['trash', 'Удалить', () => deleteTask(task)],
  ]) {
    const button = document.createElement('button');
    button.className = `icon-button${name === 'trash' ? ' delete' : ''}`;
    button.title = label;
    button.setAttribute('aria-label', `${label}: ${task.todo}`);
    button.disabled = pending.has(task.id);
    button.append(icon(name));
    if (name === 'edit') {
      const labelText = document.createElement('span');
      labelText.className = 'action-label';
      labelText.textContent = label;
      button.append(labelText);
    }
    button.addEventListener('click', handler);
    actions.append(button);
  }
  row.append(main, status, actions);
  return row;
}

function render() {
  const all = tasks();
  updateStats(all);
  const visible = all.filter(task => (filter === 'all' || (filter === 'done' ? task.completed : !task.completed)) && task.todo.toLocaleLowerCase().includes(query));
  $('#list-count').textContent = visible.length;
  const list = $('#task-list');
  list.replaceChildren();
  if (loading && !all.length) {
    list.innerHTML = '<div class="empty"><div class="loading-dot"></div><strong>Загружаем задачи</strong><p>Получаем твой список из DummyJSON…</p></div>';
  } else if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.append(icon(query ? 'search' : 'check'));
    const heading = document.createElement('strong');
    heading.textContent = query ? 'Ничего не нашлось' : filter === 'done' ? 'Выполненные задачи появятся здесь' : filter === 'active' && all.length ? 'Все задачи выполнены!' : 'Здесь пока нет задач';
    const description = document.createElement('p');
    description.textContent = query ? 'Попробуй изменить поисковый запрос.' : filter === 'done' ? 'Отметь галочкой то, что уже сделано.' : 'Добавь новое дело или обнови список из API.';
    empty.append(heading, description);
    list.append(empty);
  } else {
    const fragment = document.createDocumentFragment();
    visible.forEach(task => fragment.append(makeRow(task)));
    list.append(fragment);
  }
  $('#showing').textContent = loading ? 'Загружаем задачи…' : `Показано ${visible.length} из ${all.length} задач`;
}

async function loadTasks() {
  if (pending.size || saving) return showToast('Дождись сохранения текущего изменения.');
  loading = true;
  $('#reload').disabled = true;
  $('#notice').hidden = true;
  $('#api-status').textContent = 'Подключение';
  $('#api-status').className = 'api-badge';
  render();
  try {
    const data = await request('/todos?limit=30');
    if (!Array.isArray(data.todos) || !data.todos.every(task => validTodo(task) && Number.isInteger(task.id))) throw new Error('API вернул неожиданный формат данных.');
    baseTasks = data.todos;
    local.cache = baseTasks;
    persist();
    $('#api-status').textContent = 'Подключено';
    $('#api-status').className = 'api-badge connected';
    $('#updated').textContent = `Обновлено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    $('#notice').hidden = false;
    $('#notice').textContent = `${error.message}${baseTasks.length ? ' Показана сохранённая копия задач.' : ''}`;
    $('#api-status').textContent = 'Нет связи';
    $('#api-status').className = 'api-badge error';
    $('#updated').textContent = baseTasks.length ? 'Сохранённая копия' : 'Нажми «Обновить задачи»';
  } finally {
    loading = false;
    $('#reload').disabled = false;
    render();
  }
}

function applyChange(task, changes) {
  if (typeof task.id === 'number') local.changes[task.id] = { ...local.changes[task.id], ...changes };
  else local.created = local.created.map(item => item.id === task.id ? { ...item, ...changes } : item);
  persist();
}

async function changeTask(task, changes) {
  if (pending.has(task.id)) return;
  pending.add(task.id);
  render();
  try {
    // New DummyJSON IDs are simulated and do not exist for later PUT/DELETE.
    if (typeof task.id === 'number') await request(`/todos/${task.id}`, 'PUT', changes);
    applyChange(task, changes);
    showToast(changes.completed ? 'Ещё одно дело сделано!' : 'Задача снова в работе');
  } catch (error) { showToast(error.message); }
  finally { pending.delete(task.id); render(); }
}

async function deleteTask(task) {
  if (pending.has(task.id)) return;
  pending.add(task.id);
  render();
  try {
    if (typeof task.id === 'number') await request(`/todos/${task.id}`, 'DELETE');
    local.deleted.push(task.id);
    persist();
    showToast('Задача удалена', () => {
      local.deleted = local.deleted.filter(id => id !== task.id);
      persist();
      render();
      showToast('Задача восстановлена');
    });
  } catch (error) { showToast(error.message); }
  finally { pending.delete(task.id); render(); }
}

function openDialog(task) {
  editingId = task ? task.id : null;
  $('#dialog-title').textContent = task ? 'Изменить задачу' : 'Новая задача';
  $('#save-task').textContent = task ? 'Сохранить изменения' : 'Добавить задачу';
  $('#task-title').value = task ? task.todo : '';
  $('#task-completed').checked = task ? task.completed : false;
  $('#form-error').textContent = '';
  $('#task-dialog').showModal();
  $('#task-title').focus();
}

function closeDialog() { if (!saving) $('#task-dialog').close(); }

async function createTask(todo, completed) {
  const result = await request('/todos/add', 'POST', { todo, completed, userId: 1 });
  if (!result.id) throw new Error('API не подтвердил создание задачи.');
  local.created.unshift({ id: `local-${crypto.randomUUID()}`, todo, completed, userId: 1 });
  persist();
}

$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  const todo = $('#task-title').value.trim();
  const completed = $('#task-completed').checked;
  if (!todo) { $('#form-error').textContent = 'Напиши название задачи.'; return; }
  const task = editingId !== null ? tasks().find(item => item.id === editingId) : null;
  if (editingId !== null && (!task || pending.has(task.id))) { $('#form-error').textContent = 'Задача сейчас недоступна. Закрой окно и попробуй ещё раз.'; return; }
  saving = true;
  $('#form-error').textContent = '';
  $('#save-task').disabled = true;
  $('#save-task').textContent = 'Сохраняем…';
  if (task) pending.add(task.id);
  try {
    if (task) {
      if (typeof task.id === 'number') await request(`/todos/${task.id}`, 'PUT', { todo, completed });
      applyChange(task, { todo, completed });
    } else await createTask(todo, completed);
    filter = 'all'; query = ''; $('#search').value = '';
    $('#task-dialog').close();
    showToast(task ? 'Изменения сохранены' : 'Задача добавлена. Первый шаг сделан!');
  } catch (error) { $('#form-error').textContent = error.message; }
  finally {
    saving = false;
    if (task) pending.delete(task.id);
    $('#save-task').disabled = false;
    $('#save-task').textContent = task ? 'Сохранить изменения' : 'Добавить задачу';
    render();
  }
});

$('#quick-add').addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  const todo = $('#quick-title').value.trim();
  if (!todo) { $('#quick-title').setCustomValidity('Напиши название задачи.'); $('#quick-title').reportValidity(); return; }
  saving = true;
  $('#quick-submit').disabled = true;
  try {
    await createTask(todo, false);
    $('#quick-title').value = '';
    filter = 'all'; query = ''; $('#search').value = '';
    showToast('Новая задача добавлена');
  } catch (error) { showToast(error.message); }
  finally { saving = false; $('#quick-submit').disabled = false; render(); }
});
$('#quick-title').addEventListener('input', () => $('#quick-title').setCustomValidity(''));
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; render(); }));
$('#search').addEventListener('input', event => { query = event.target.value.toLocaleLowerCase().trim(); render(); });
$('#reload').addEventListener('click', loadTasks);
$('#new-task').addEventListener('click', () => { if (!saving) openDialog(); });
$('#close-dialog').addEventListener('click', closeDialog);
$('#cancel-dialog').addEventListener('click', closeDialog);
$('#task-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
$('#task-dialog').addEventListener('click', event => {
  const rect = $('#task-dialog').getBoundingClientRect();
  if (event.target === $('#task-dialog') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDialog();
});
$('#export').addEventListener('click', () => {
  const all = tasks();
  if (!all.length) return showToast('Пока нет задач для экспорта.');
  const blob = new Blob([JSON.stringify({ todos: all }, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url; link.download = 'my-tasks.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Список задач скачан');
});
$('#date').textContent = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
loadTasks();
