import * as store from "../store.js";
import { getSession, signIn, signOut } from "../supabase.js";
import { filterChannels, folderName } from "../lib/parse.js";

const $ = (id) => document.getElementById(id);

let state = { folders: [], channels: [], activeFolder: null }; // starts on Unsorted
let checked = new Set();

// Which folder is being renamed. NOT null when idle — null is Unsorted's own id,
// and `renaming === f.id` would then match Unsorted on every render.
const NOT_RENAMING = Symbol("not renaming");
let renaming = NOT_RENAMING;

// ---------- boot ----------

(async function boot() {
  if (await getSession()) showMain();
  else {
    show("login");
    $("email").focus();
  }
})();

function show(which) {
  $("login").classList.toggle("hidden", which !== "login");
  $("main").classList.toggle("hidden", which !== "main");
}

function showMain() {
  show("main");
  store.load((data, meta) => {
    state.folders = data.folders;
    state.channels = data.channels;
    render();
    if (meta.error) setStatus(meta.error.message, true);
    else if (!meta.stale) setStatus("");
  });
}

function setStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").classList.toggle("err", isError);
}

// Wraps a write so a failure shows up instead of silently doing nothing.
//
// The store writes through to the cache, so re-reading it is what makes the write
// visible. Rendering off `state` alone would paint the pre-write data — and on a
// failed write, re-reading is what rolls the view back to what's actually stored.
async function attempt(fn) {
  try {
    setStatus("saving…");
    await fn();
    setStatus("");
  } catch (e) {
    setStatus(e.message, true);
  }
  const { folders, channels } = await store.readCache();
  state.folders = folders;
  state.channels = channels;
  render();
}

// ---------- login ----------

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-btn").disabled = true;
  $("login-error").textContent = "";
  try {
    await signIn($("email").value.trim(), $("password").value);
    showMain();
  } catch (err) {
    $("login-error").textContent = err.message;
  } finally {
    $("login-btn").disabled = false;
  }
});

$("signout").addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut();
  show("login");
});

// ---------- render ----------

function render() {
  renderFolders();
  renderRows();
  renderBulk();
}

function renderFolders() {
  const counts = (id) => state.channels.filter((c) => (c.folder_id ?? null) === id).length;
  const items = [
    ...state.folders.map((f) => ({ id: f.id, name: f.name, deletable: true })),
    { id: null, name: "Unsorted", deletable: false },
  ];

  $("folders").innerHTML =
    items
      .map((f) => {
        if (renaming === f.id) {
          return `<div class="dfolder on"><input data-rename="${f.id}" value="${escapeHtml(f.name)}"></div>`;
        }
        return `
        <div class="dfolder ${state.activeFolder === f.id ? "on" : ""}" data-id="${f.id}">
          📁 <span>${escapeHtml(f.name)}</span>
          <span class="n">${counts(f.id)}</span>
          ${f.deletable ? `<span class="x" data-del="${f.id}" title="Delete folder">✕</span>` : ""}
        </div>`;
      })
      .join("") + `<div class="newf" id="newf">+ New folder</div>`;

  $("newf").addEventListener("click", async () => {
    const name = prompt("Folder name?");
    if (name?.trim()) await attempt(() => store.addFolder(name.trim()));
  });

  for (const el of $("folders").querySelectorAll(".dfolder")) {
    const raw = el.dataset.id;
    if (raw === undefined) continue;
    const id = raw === "null" ? null : Number(raw);

    el.addEventListener("click", (e) => {
      if (e.target.dataset.del !== undefined) return;
      state.activeFolder = id;
      checked.clear();
      render();
    });

    el.addEventListener("dblclick", () => {
      if (id === null) return; // Unsorted isn't a real folder
      renaming = id;
      render();
      const input = $("folders").querySelector("[data-rename]");
      input?.focus();
      input?.select();
    });
  }

  for (const x of $("folders").querySelectorAll("[data-del]")) {
    x.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(x.dataset.del);
      const n = counts(id);
      const msg = n
        ? `Delete this folder?\n\nIts ${n} channel${n > 1 ? "s" : ""} won't be deleted — they move to Unsorted.`
        : "Delete this folder?";
      if (!confirm(msg)) return;
      if (state.activeFolder === id) state.activeFolder = null;
      await attempt(() => store.removeFolder(id));
    });
  }

  const input = $("folders").querySelector("[data-rename]");
  if (input) {
    // Ending the rename re-renders, which tears this input out of the DOM and
    // fires `blur` on the way. Without this latch that blur runs finish() a
    // second time — saving twice on Enter, and saving anyway on Escape.
    let settled = false;
    const finish = async (save) => {
      if (settled) return;
      settled = true;
      const id = Number(input.dataset.rename);
      const name = input.value.trim();
      const before = state.folders.find((f) => f.id === id)?.name;
      renaming = NOT_RENAMING;
      if (save && name && name !== before) await attempt(() => store.renameFolder(id, name));
      else render();
    };
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
  }
}

function renderRows() {
  const q = $("search").value;
  const rows = filterChannels(state.channels, q, state.activeFolder);

  $("title").textContent = q
    ? `${rows.length} match${rows.length === 1 ? "" : "es"} across all folders`
    : `${folderName(state.folders, state.activeFolder)} — ${rows.length} channel${rows.length === 1 ? "" : "s"}`;

  $("rows").innerHTML = rows.length
    ? rows
        .map(
          (c) => `
      <div class="drow">
        <input type="checkbox" data-id="${c.id}" ${checked.has(c.id) ? "checked" : ""}>
        <img class="avatar" src="${escapeHtml(c.avatar_url || "")}" alt="">
        <a href="${escapeHtml(c.url || `https://www.youtube.com/channel/${c.yt_channel_id}`)}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>
        <span class="tag">${escapeHtml(folderName(state.folders, c.folder_id))}</span>
      </div>`
        )
        .join("")
    : `<div class="empty">Nothing here</div>`;

  for (const box of $("rows").querySelectorAll("input[type=checkbox]")) {
    box.addEventListener("change", () => {
      const id = Number(box.dataset.id);
      box.checked ? checked.add(id) : checked.delete(id);
      renderBulk();
    });
  }
}

function renderBulk() {
  $("bulk").classList.toggle("hidden", checked.size === 0);
  if (!checked.size) return;

  $("bulkcount").textContent = `${checked.size} selected →`;
  $("moveto").innerHTML = "";
  $("moveto").append(new Option("— pick —", ""));
  for (const f of state.folders) $("moveto").append(new Option(f.name, f.id));
  $("moveto").append(new Option("Unsorted", "null"));
}

$("moveto").addEventListener("change", async () => {
  const v = $("moveto").value;
  if (v === "") return;
  const ids = [...checked];
  checked.clear();
  await attempt(() => store.moveChannels(ids, v === "null" ? null : Number(v)));
});

$("remove").addEventListener("click", async () => {
  const ids = [...checked];
  if (!confirm(`Remove ${ids.length} channel${ids.length > 1 ? "s" : ""} from your catalog?`)) return;
  checked.clear();
  await attempt(() => store.removeChannels(ids));
});

$("search").addEventListener("input", () => {
  checked.clear();
  render();
});

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
