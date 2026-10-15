const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const todos = [
  { id: 1, todo: "Write report", completed: false, userId: 1 },
  { id: 2, todo: "Buy milk", completed: true, userId: 2 },
];
const users = [
  {
    id: 1,
    firstName: "Emily",
    lastName: "Johnson",
    username: "emilys",
    email: "emily@example.com",
    phone: "123",
  },
  {
    id: 2,
    firstName: "Alex",
    lastName: "Smith",
    username: "alex",
    email: "alex@example.com",
    phone: "456",
  },
];
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function boot(storage) {
  const dom = new JSDOM(html, {
    url: "http://localhost",
    runScripts: "outside-only",
  });
  const w = dom.window,
    calls = [];
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  if (storage) w.localStorage.setItem("delo-7apta-v1", storage);
  w.fetch = async (url, options = {}) => {
    calls.push({
      url,
      method: options.method,
      body: options.body && JSON.parse(options.body),
    });
    return {
      ok: true,
      json: async () =>
        url.includes("/todos/add")
          ? { id: 255 }
          : url.includes("/users?")
            ? { users: structuredClone(users) }
            : url.includes("/todos?")
              ? { todos: structuredClone(todos) }
              : {},
    };
  };
  w.eval(source);
  await settle();
  return { dom, w, calls, $: (s) => w.document.querySelector(s) };
}
function submit(w, form) {
  form.dispatchEvent(
    new w.Event("submit", { bubbles: true, cancelable: true }),
  );
}
test("loads all records, filters tasks, sends API sorting and opens profile", async () => {
  const { dom, w, calls, $ } = await boot();
  try {
    assert.equal($("#total").textContent, "2");
    assert.equal($("#people-count").textContent, "2");
    assert.ok(calls.some((c) => c.url.includes("/todos?limit=0")));
    $("#search").value = "write";
    $("#search").dispatchEvent(new w.Event("input"));
    assert.equal(w.document.querySelectorAll("#task-list .task-row").length, 1);
    $("#sort").value = "asc";
    $("#sort").dispatchEvent(new w.Event("change"));
    await settle();
    assert.ok(calls.some((c) => c.url.includes("sortBy=todo&order=asc")));
    $("#task-list .user-chip").click();
    assert.equal($("#profile-dialog").open, true);
    assert.match($("#profile-content").textContent, /Emily Johnson/);
    assert.match($("#profile-content").textContent, /ID 1/);
    $("#profile-content .primary").click();
    assert.equal($("#task-person").value, "1");
  } finally {
    dom.window.close();
  }
});
test("creates unique tasks, edits local tasks, persists across reload and deletes", async () => {
  const { dom, w, calls, $ } = await boot();
  try {
    for (const title of ["New one", "New two"]) {
      $("#new-task").click();
      $("#task-title").value = title;
      $("#task-person").value = "2";
      submit(w, $("#task-form"));
      await settle();
    }
    let saved = JSON.parse(w.localStorage.getItem("delo-7apta-v1"));
    assert.equal(saved.created.length, 2);
    assert.notEqual(saved.created[0].id, saved.created[1].id);
    assert.notEqual(saved.created[0].displayId, saved.created[1].displayId);
    const first = $("#task-list .task-row");
    first.querySelector('[aria-label="Изменить задачу"]').click();
    $("#task-title").value = "Updated local";
    $("#task-person").value = "1";
    submit(w, $("#task-form"));
    await settle();
    assert.equal(calls.filter((c) => c.method === "PUT").length, 0);
    assert.match($("#task-list").textContent, /Updated local/);
    const reload = await boot(w.localStorage.getItem("delo-7apta-v1"));
    assert.equal(reload.$("#total").textContent, "4");
    assert.match(reload.$("#task-list").textContent, /Updated local/);
    reload.dom.window.close();
    $("#task-list .delete").click();
    submit(w, $("#delete-form"));
    await settle();
    assert.equal($("#total").textContent, "3");
    assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
  } finally {
    dom.window.close();
  }
});
test("API updates, reassignment, profile edit and deletion survive fresh GET", async () => {
  const { dom, w, calls, $ } = await boot();
  try {
    $('#task-list [aria-label="Изменить задачу"]').click();
    $("#task-title").value = "Changed remote";
    $("#task-person").value = "2";
    $("#task-completed").checked = true;
    submit(w, $("#task-form"));
    await settle();
    assert.ok(calls.some((c) => c.method === "PUT" && c.body.userId === 2));
    $("#refresh").click();
    await settle();
    assert.match($("#task-list").textContent, /Changed remote/);
    assert.equal($("#done").textContent, "2");
    $("#task-list .user-chip").click();
    $("#profile-content .secondary").click();
    $("#person-first").value = "Alexandra";
    submit(w, $("#person-form"));
    await settle();
    assert.ok(
      calls.some((c) => c.url.endsWith("/users/2") && c.method === "PUT"),
    );
    assert.match($("#profile-content").textContent, /Alexandra/);
    $("#profile-dialog").close();
    $("#task-list .delete").click();
    submit(w, $("#delete-form"));
    await settle();
    $("#refresh").click();
    await settle();
    assert.equal($("#total").textContent, "1");
    assert.ok(calls.some((c) => c.method === "DELETE"));
  } finally {
    dom.window.close();
  }
});
test("failed mutation retains data and shows error; user text is rendered safely", async () => {
  const { dom, w, $ } = await boot();
  try {
    $('#task-list [aria-label="Изменить задачу"]').click();
    $("#task-title").value = "<img src=x onerror=alert(1)>";
    w.fetch = async () => ({ ok: false, status: 503 });
    submit(w, $("#task-form"));
    await settle();
    assert.equal($("#task-dialog").open, true);
    assert.match($("#task-form .form-error").textContent, /503/);
    assert.match($("#task-list").textContent, /Write report/);
    assert.equal($("#total").textContent, "2");
    w.fetch = async () => ({ ok: true, json: async () => ({}) });
    submit(w, $("#task-form"));
    await settle();
    assert.match($("#task-list").textContent, /<img src=x/);
    assert.equal($("#task-list .task-name img"), null);
  } finally {
    dom.window.close();
  }
});
