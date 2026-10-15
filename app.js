"use strict";
const API = "https://dummyjson.com";
const KEY = "delo-7apta-v1";
const $ = (s) => document.querySelector(s);
const blank = () => ({
  created: [],
  changed: {},
  deleted: [],
  users: {},
  taskCache: [],
  userCache: [],
});
let saved = blank();
try {
  const value = JSON.parse(localStorage.getItem(KEY));
  if (value && Array.isArray(value.created) && Array.isArray(value.deleted))
    saved = { ...blank(), ...value };
} catch {}
let baseTasks = saved.taskCache,
  basePeople = saved.userCache;
let statusFilter = "all",
  shown = 30,
  editing = null,
  deleting = null,
  profileId = null,
  busy = false,
  loadVersion = 0,
  peopleVersion = 0;
const name = (u) =>
  `${u?.firstName || "Пользователь"} ${u?.lastName || ""}`.trim();
const people = () =>
  basePeople
    .map((u) => ({ ...u, ...saved.users[u.id] }))
    .sort(
      (a, b) =>
        name(a).localeCompare(name(b)) *
        ($("#people-sort").value === "desc" ? -1 : 1),
    );
const person = (id) => people().find((u) => u.id === Number(id));
const tasks = () =>
  [
    ...saved.created,
    ...baseTasks.map((t) => ({ ...t, ...saved.changed[t.id] })),
  ].filter((t) => !saved.deleted.includes(t.id));
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    $("#notice").textContent =
      "Хранилище браузера недоступно: изменения сохранятся только до закрытия страницы.";
    $("#notice").hidden = false;
  }
}
async function request(path, method = "GET", body) {
  const response = await fetch(API + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok)
    throw new Error(`Ошибка API (${response.status}). Повторите попытку.`);
  return response.json();
}
function avatar(u) {
  const img = el("img", "avatar");
  img.alt = "";
  if (u?.image) {
    img.src = u.image;
    img.loading = "lazy";
    img.addEventListener("error", () => img.removeAttribute("src"), {
      once: true,
    });
  }
  return img;
}
function action(label, icon, handler, cls = "") {
  const b = el("button", "icon-button " + cls, icon);
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.onclick = handler;
  return b;
}
function row(task) {
  const r = el("article", "task-row" + (task.completed ? " completed" : ""));
  const check = el("input");
  check.type = "checkbox";
  check.checked = task.completed;
  check.disabled = busy;
  check.setAttribute("aria-label", `Выполнено: ${task.todo}`);
  check.onchange = () =>
    mutation(async () => {
      await updateTask(task, { completed: check.checked });
    }, null);
  const content = el("div", "task-text");
  content.append(el("div", "task-name", task.todo));
  const meta = el("div", "task-meta");
  const u = person(task.userId);
  const chip = el("button", "user-chip");
  chip.type = "button";
  chip.append(
    avatar(u),
    document.createTextNode(`@${u?.username || "user"} · ID ${task.userId}`),
  );
  chip.onclick = () => openProfile(task.userId);
  meta.append(
    chip,
    el("span", "task-id", `Задача #${task.displayId || task.id}`),
  );
  content.append(meta);
  const actions = el("div", "row-actions");
  actions.append(
    action("Изменить задачу", "✎", () => openTask(task)),
    action(
      "Удалить задачу",
      "×",
      () => {
        deleting = task;
        $("#delete-title").textContent = task.todo;
        $("#delete-form .form-error").textContent = "";
        $("#delete-dialog").showModal();
      },
      "delete",
    ),
  );
  r.append(
    check,
    content,
    el(
      "span",
      "status" + (task.completed ? " done" : ""),
      task.completed ? "Выполнено" : "В работе",
    ),
    actions,
  );
  return r;
}
function fillSelects() {
  const list = people().sort((a, b) => name(a).localeCompare(name(b)));
  for (const selector of ["#task-person", "#person-filter"]) {
    const select = $(selector),
      old = select.value;
    select.replaceChildren(
      new Option(
        selector === "#task-person" ? "Выберите человека" : "Все люди",
        "",
      ),
    );
    list.forEach((u) =>
      select.add(new Option(`${name(u)} (@${u.username}) · ID ${u.id}`, u.id)),
    );
    select.value = old;
  }
}
function render() {
  const all = tasks(),
    done = all.filter((t) => t.completed).length;
  $("#total").textContent = all.length;
  $("#pending").textContent = all.length - done;
  $("#done").textContent = done;
  $("#progress").textContent =
    `${all.length ? Math.round((done / all.length) * 100) : 0}%`;
  $("#nav-count").textContent = all.length;
  $("#people-count").textContent = people().length;
  const q = $("#search").value.trim().toLocaleLowerCase(),
    uid = $("#person-filter").value;
  let list = all.filter(
    (t) =>
      (!q || t.todo.toLocaleLowerCase().includes(q)) &&
      (!uid || String(t.userId) === uid) &&
      (statusFilter === "all" || t.completed === (statusFilter === "done")),
  );
  const sort = $("#sort").value;
  if (sort)
    list.sort(
      (a, b) => a.todo.localeCompare(b.todo) * (sort === "desc" ? -1 : 1),
    );
  $("#result-count").textContent = `${list.length} / ${all.length}`;
  $("#task-list").replaceChildren(...list.slice(0, shown).map(row));
  if (!list.length)
    $("#task-list").append(
      el(
        "div",
        "empty",
        baseTasks.length || saved.created.length
          ? "Задачи не найдены. Измените фильтры или создайте новую."
          : "Пока нет задач. Создайте первую или нажмите «Обновить».",
      ),
    );
  $("#list-info").textContent =
    `Показано ${Math.min(shown, list.length)} из ${list.length} задач`;
  $("#more").hidden = shown >= list.length;
  renderPeople();
  if ($("#profile-dialog").open) renderProfile();
}
function renderPeople() {
  const query = $("#people-search").value.trim().toLocaleLowerCase();
  const list = people().filter((u) =>
    `${name(u)} ${u.username} ${u.id}`.toLocaleLowerCase().includes(query),
  );
  $("#directory-count").textContent = list.length;
  const all = tasks();
  $("#people-list").replaceChildren(
    ...list.map((u) => {
      const card = el("article", "person-card");
      card.append(
        avatar(u),
        el("h3", "", name(u)),
        el("p", "", `@${u.username} · ID ${u.id}`),
        el("p", "", `Задач: ${all.filter((t) => t.userId === u.id).length}`),
      );
      const b = el("button", "secondary", "Открыть профиль →");
      b.onclick = () => openProfile(u.id);
      card.append(b);
      return card;
    }),
  );
  if (!list.length)
    $("#people-list").append(el("p", "empty", "Люди не найдены."));
}
async function loadTasks() {
  const version = ++loadVersion;
  $("#refresh").disabled = true;
  $("#refresh").textContent = "Загрузка…";
  try {
    const order = $("#sort").value;
    const data = await request(
      "/todos?limit=0" + (order ? `&sortBy=todo&order=${order}` : ""),
    );
    if (version !== loadVersion) return;
    if (!Array.isArray(data.todos))
      throw new Error("API вернул неверный список задач.");
    baseTasks = data.todos;
    saved.taskCache = baseTasks;
    $("#notice").hidden = true;
    persist();
    render();
  } catch (e) {
    if (version !== loadVersion) return;
    $("#notice").textContent =
      (baseTasks.length
        ? "Показываем сохранённые задачи. "
        : "Не удалось загрузить задачи. ") + e.message;
    $("#notice").hidden = false;
    render();
  } finally {
    if (version === loadVersion) {
      $("#refresh").disabled = false;
      $("#refresh").textContent = "↻ Обновить";
    }
  }
}
async function loadPeople() {
  const version = ++peopleVersion;
  try {
    const fields =
      "id,firstName,lastName,username,image,email,phone,age,gender,birthDate,address,company,university,role,height,weight,bloodGroup";
    const data = await request(
      `/users?limit=0&sortBy=firstName&order=${$("#people-sort").value}&select=${fields}`,
    );
    if (version !== peopleVersion) return;
    if (!Array.isArray(data.users)) throw new Error("Неверный список людей.");
    basePeople = data.users;
    saved.userCache = basePeople;
    persist();
    fillSelects();
    render();
  } catch (e) {
    if (version !== peopleVersion) return;
    toast("Не удалось обновить людей. " + e.message);
    fillSelects();
    render();
  }
}
async function mutation(fn, form, success) {
  if (busy) return;
  busy = true;
  document
    .querySelectorAll('button[type="submit"],.dialog-actions button')
    .forEach((b) => (b.disabled = true));
  if (form) form.querySelector(".form-error").textContent = "";
  try {
    await fn();
    persist();
    fillSelects();
    if (form) form.closest("dialog").close();
    if (success) toast(success);
  } catch (e) {
    if (form) form.querySelector(".form-error").textContent = e.message;
    else toast(e.message);
  } finally {
    busy = false;
    document
      .querySelectorAll('.dialog-actions button,button[type="submit"]')
      .forEach((b) => (b.disabled = false));
    render();
  }
}
async function updateTask(task, patch) {
  if (typeof task.id === "string") {
    saved.created = saved.created.map((t) =>
      t.id === task.id ? { ...t, ...patch } : t,
    );
  } else {
    await request(`/todos/${task.id}`, "PUT", patch);
    saved.changed[task.id] = { ...saved.changed[task.id], ...patch };
  }
}
function openTask(task = null, userId = null) {
  editing = task;
  $("#task-dialog-title").textContent = task
    ? "Изменить задачу"
    : "Новая задача";
  $("#task-title").value = task?.todo || "";
  $("#task-completed").checked = task?.completed || false;
  fillSelects();
  $("#task-person").value = String(task?.userId || userId || "");
  $("#task-form .form-error").textContent = "";
  $("#task-dialog").showModal();
  $("#task-title").focus();
}
$("#task-form").onsubmit = (e) => {
  e.preventDefault();
  const todo = $("#task-title").value.trim(),
    userId = Number($("#task-person").value),
    completed = $("#task-completed").checked;
  if (!todo || !person(userId)) {
    $("#task-form .form-error").textContent =
      "Введите название и выберите человека.";
    return;
  }
  mutation(
    async () => {
      if (editing) await updateTask(editing, { todo, userId, completed });
      else {
        const result = await request("/todos/add", "POST", {
          todo,
          userId,
          completed,
        });
        const displayId = Math.max(
          Number(result.id) || 1,
          ...tasks().map((t) => Number(t.displayId || t.id) + 1 || 1),
        );
        saved.created.unshift({
          id: "local-" + crypto.randomUUID(),
          displayId,
          todo,
          userId,
          completed,
        });
      }
    },
    e.currentTarget,
    editing ? "Задача изменена" : "Задача создана",
  );
};
$("#delete-form").onsubmit = (e) => {
  e.preventDefault();
  mutation(
    async () => {
      if (typeof deleting.id === "number")
        await request(`/todos/${deleting.id}`, "DELETE");
      if (typeof deleting.id === "string")
        saved.created = saved.created.filter((t) => t.id !== deleting.id);
      else saved.deleted.push(deleting.id);
    },
    e.currentTarget,
    "Задача удалена",
  );
};
function openProfile(id) {
  if (!person(id)) {
    toast("Профиль ещё не загружен. Нажмите «Обновить».");
    return;
  }
  profileId = Number(id);
  renderProfile();
  if (!$("#profile-dialog").open) $("#profile-dialog").showModal();
}
function renderProfile() {
  const u = person(profileId);
  if (!u) return;
  const layout = el("div", "profile-layout"),
    left = el("section"),
    right = el("section", "profile-tasks"),
    hero = el("div", "profile-hero"),
    intro = el("div");
  intro.append(
    el("h3", "", name(u)),
    el("p", "", `@${u.username} · ID ${u.id}`),
  );
  hero.append(avatar(u), intro);
  left.append(hero);
  const address = u.address || {},
    company = u.company || {};
  const fields = [
    ["Email", u.email],
    ["Телефон", u.phone],
    ["Возраст", u.age],
    [
      "Пол",
      u.gender === "male"
        ? "Мужской"
        : u.gender === "female"
          ? "Женский"
          : u.gender,
    ],
    ["Дата рождения", u.birthDate],
    [
      "Адрес",
      [address.address, address.city, address.state, address.country]
        .filter(Boolean)
        .join(", "),
    ],
    ["Индекс", address.postalCode],
    ["Компания", company.name],
    ["Отдел", company.department],
    ["Должность", company.title],
    ["Университет", u.university],
    ["Роль", u.role],
    ["Рост / вес", `${u.height ?? "—"} см / ${u.weight ?? "—"} кг`],
    ["Группа крови", u.bloodGroup],
  ];
  const dl = el("dl", "details");
  for (const [key, value] of fields) {
    const d = el("div");
    d.append(el("dt", "", key), el("dd", "", value ?? "—"));
    dl.append(d);
  }
  left.append(dl);
  const tools = el("div", "profile-tools"),
    edit = el("button", "secondary", "Изменить профиль");
  edit.onclick = () => {
    for (const [field, key] of [
      ["first", "firstName"],
      ["last", "lastName"],
      ["email", "email"],
      ["phone", "phone"],
    ])
      $("#person-" + field).value = u[key] || "";
    $("#person-form .form-error").textContent = "";
    $("#person-dialog").showModal();
  };
  tools.append(edit);
  left.append(tools);
  const assigned = tasks().filter((t) => t.userId === u.id);
  right.append(el("h3", "", `Задачи человека · ${assigned.length}`));
  const add = el("button", "primary", "＋ Назначить задачу");
  add.onclick = () => openTask(null, u.id);
  right.append(add);
  if (!assigned.length)
    right.append(el("p", "empty", "Пока нет задач. Назначьте первую."));
  assigned.forEach((t) => right.append(row(t)));
  layout.append(left, right);
  $("#profile-content").replaceChildren(layout);
}
$("#person-form").onsubmit = (e) => {
  e.preventDefault();
  const patch = {
    firstName: $("#person-first").value.trim(),
    lastName: $("#person-last").value.trim(),
    email: $("#person-email").value.trim(),
    phone: $("#person-phone").value.trim(),
  };
  if (Object.values(patch).some((v) => !v)) {
    $("#person-form .form-error").textContent = "Заполните все поля.";
    return;
  }
  mutation(
    async () => {
      await request(`/users/${profileId}`, "PUT", patch);
      saved.users[profileId] = { ...saved.users[profileId], ...patch };
    },
    e.currentTarget,
    "Профиль изменён",
  );
};
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.querySelectorAll(".close").forEach(
    (b) =>
      (b.onclick = () => {
        if (!busy) dialog.close();
      }),
  );
  dialog.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
});
document.querySelectorAll("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-view]")
        .forEach((x) => x.classList.toggle("active", x === b));
      const isTasks = b.dataset.view === "tasks";
      $("#tasks-view").hidden = !isTasks;
      $("#people-view").hidden = isTasks;
      $("#page-title").textContent = isTasks ? "Ваши задачи" : "Ваша команда";
      $("#page-subtitle").textContent = isTasks
        ? "Освободите голову. Соберите все дела в одном месте."
        : "У каждого дела есть свой человек. Найдите и назначьте.";
    }),
);
document.querySelectorAll("[data-status]").forEach(
  (b) =>
    (b.onclick = () => {
      statusFilter = b.dataset.status;
      shown = 30;
      document
        .querySelectorAll("[data-status]")
        .forEach((x) => x.classList.toggle("selected", x === b));
      render();
    }),
);
$("#new-task").onclick = () => openTask();
$("#refresh").onclick = () => Promise.all([loadTasks(), loadPeople()]);
$("#sort").onchange = () => {
  shown = 30;
  render();
  loadTasks();
};
$("#people-sort").onchange = () => {
  renderPeople();
  loadPeople();
};
$("#search").oninput = $("#person-filter").onchange = () => {
  shown = 30;
  render();
};
$("#people-search").oninput = renderPeople;
$("#more").onclick = () => {
  shown += 30;
  render();
};
fillSelects();
if (baseTasks.length) render();
Promise.all([loadTasks(), loadPeople()]);
