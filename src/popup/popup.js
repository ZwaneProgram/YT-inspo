import * as store from "../store.js";
import { getSession, signIn, signOut } from "../supabase.js";
import { filterChannels, folderName, accountUrl } from "../lib/parse.js";

const $ = (id) => document.getElementById(id);

let state = { folders: [], channels: [], activeFolder: "all", cursor: 0 };
let pageChannel = null; // the channel on the current tab, if any

// ---------- boot ----------

(async function boot() {
  if (await getSession()) {
    showMain();
  } else {
    show("login");
    $("email").focus();
  }
})();

function show(which) {
  $("login").classList.toggle("hidden", which !== "login");
  $("main").classList.toggle("hidden", which !== "main");
}

async function showMain() {
  show("main");
  $("search").focus();

  const session = await getSession();
  $("who").textContent = session?.email || "";

  // Paint from cache, then again once the server answers.
  store.load((data, meta) => {
    state.folders = data.folders;
    state.channels = data.channels;
    render();
    if (meta.error) setStatus(meta.error.message, true);
    else if (!meta.stale) setStatus("");
  });

  detectPageChannel();
}

function setStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").classList.toggle("err", isError);
}

// ---------- login ----------

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-btn").disabled = true;
  $("login-error").textContent = "";
  try {
    await signIn($("email").value.trim(), $("password").value);
    await showMain();
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

$("open-dashboard").addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
  window.close();
});

// ---------- save card ----------

async function detectPageChannel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("youtube.com")) return;

  const res = await chrome.tabs
    .sendMessage(tab.id, { type: "readChannel" })
    .catch(() => null); // content script not on this page — fine, no save card

  if (!res?.channel) return;

  pageChannel = res.channel;
  $("save-title").textContent = pageChannel.title;
  if (pageChannel.avatarUrl) $("save-avatar").src = pageChannel.avatarUrl;
  $("save-card").classList.remove("hidden");
  renderSaveState();
}

function renderSaveState() {
  if (!pageChannel) return;
  const existing = state.channels.find(
    (c) => c.platform === pageChannel.platform && c.platform_id === pageChannel.platformId
  );
  const card = $("save-card");

  $("save-folder").innerHTML = "";
  $("save-folder").append(new Option("Unsorted", ""));
  for (const f of state.folders) $("save-folder").append(new Option(f.name, f.id));

  if (existing) {
    card.classList.add("saved");
    $("save-sub").textContent = `already in ${folderName(state.folders, existing.folder_id)}`;
    $("save-folder").value = existing.folder_id ?? "";
    $("save-btn").textContent = "Saved";
    $("save-btn").disabled = true;
  } else {
    card.classList.remove("saved");
    $("save-sub").textContent = "on this tab";
    $("save-btn").textContent = "Save";
    $("save-btn").disabled = false;
  }
}

$("save-btn").addEventListener("click", async () => {
  if (!pageChannel) return;
  $("save-btn").disabled = true;
  $("save-btn").textContent = "saving…";
  try {
    const folderId = $("save-folder").value ? Number($("save-folder").value) : null;
    const row = await store.saveChannel({ ...pageChannel, folder_id: folderId });
    state.channels = [row, ...state.channels.filter((c) => c.id !== row.id)];
    render();
    renderSaveState();
    window.close();
  } catch (err) {
    $("save-btn").disabled = false;
    $("save-btn").textContent = "Retry";
    setStatus(err.message, true);
  }
});

// Changing the folder on an already-saved channel moves it.
$("save-folder").addEventListener("change", async () => {
  if (!pageChannel) return;
  const existing = state.channels.find(
    (c) => c.platform === pageChannel.platform && c.platform_id === pageChannel.platformId
  );
  if (!existing) return;
  const folderId = $("save-folder").value ? Number($("save-folder").value) : null;
  try {
    await store.moveChannels([existing.id], folderId);
    existing.folder_id = folderId;
    render();
    renderSaveState();
  } catch (err) {
    setStatus(err.message, true);
  }
});

// ---------- browse ----------

function visibleChannels() {
  return filterChannels(state.channels, $("search").value, state.activeFolder);
}

function render() {
  const counts = (id) => state.channels.filter((c) => (c.folder_id ?? null) === id).length;

  const chips = [
    { id: "all", name: "All", n: state.channels.length },
    ...state.folders.map((f) => ({ id: f.id, name: `📁 ${f.name}`, n: counts(f.id) })),
    { id: null, name: "📁 Unsorted", n: counts(null) },
  ];

  $("folders").innerHTML = chips
    .map(
      (c, i) =>
        `<div class="folder ${state.activeFolder === c.id ? "on" : ""}" data-i="${i}">` +
        `${c.name}<span class="n">${c.n}</span></div>`
    )
    .join("");

  [...$("folders").children].forEach((el, i) => {
    el.addEventListener("click", () => {
      state.activeFolder = chips[i].id;
      $("search").value = "";
      state.cursor = 0;
      render();
    });
  });

  const rows = visibleChannels();
  if (state.cursor >= rows.length) state.cursor = Math.max(0, rows.length - 1);

  $("list").innerHTML = rows.length
    ? rows
        .map(
          (c, i) => `
      <div class="row ${i === state.cursor ? "sel" : ""}" data-i="${i}">
        <img class="avatar" src="${escapeHtml(c.avatar_url || "")}" alt="">
        <div class="name">${escapeHtml(c.title)}</div>
        <div class="tag">${escapeHtml(folderName(state.folders, c.folder_id))}</div>
      </div>`
        )
        .join("")
    : `<div class="empty">${state.channels.length ? "No matches" : "Nothing saved yet — hit ➕ Inspo on a channel"}</div>`;

  [...$("list").children].forEach((el) => {
    const i = Number(el.dataset.i);
    if (Number.isNaN(i)) return;
    el.addEventListener("click", () => open(rows[i]));
  });

  if (pageChannel) renderSaveState();
}

function open(channel) {
  chrome.tabs.create({ url: accountUrl(channel) });
  window.close();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------- keyboard ----------

$("search").addEventListener("input", () => {
  state.cursor = 0;
  render();
});

document.addEventListener("keydown", (e) => {
  if ($("main").classList.contains("hidden")) return;
  const rows = visibleChannels();

  if (e.key === "ArrowDown") {
    e.preventDefault();
    state.cursor = Math.min(state.cursor + 1, rows.length - 1);
    render();
    $("list").children[state.cursor]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    state.cursor = Math.max(state.cursor - 1, 0);
    render();
    $("list").children[state.cursor]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    // Enter on an untouched search box means "save what I'm looking at".
    if (!$("search").value && pageChannel && !$("save-btn").disabled) {
      $("save-btn").click();
    } else if (rows[state.cursor]) {
      open(rows[state.cursor]);
    }
  }
});
