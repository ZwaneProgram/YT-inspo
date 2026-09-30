// The ➕ Inspo button, the folder picker and the error toast.
//
// Knows nothing about YouTube or Instagram: a platform adapter supplies
// `platform`, `isSaveablePage(url)`, `findAnchor()`, `readAccount()` and
// `onNavigate(cb)`. See src/lib/platforms/ for the two implementations.
//
// Both sites are single-page apps: they swap pages without a reload and
// rebuild the header DOM on the fly. That's why lifecycle needs two mechanisms,
// not one — `adapter.onNavigate` re-attaches when the URL changes, and the
// standing MutationObserver re-attaches when the header we're anchored to gets
// replaced out from under us without a navigation event to hang it on. Neither
// one is redundant with the other; don't delete either.

import { folderNameTaken, TIERS } from "./parse.js";

const BTN_ID = "yt-inspo-btn";

export function start(adapter) {
  const send = (msg) =>
    new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false })));

  // ---------- the button ----------

  function paint(btn, state, label) {
    btn.className = `yt-inspo-btn ${state}`;
    btn.textContent = label;
  }

  async function refreshState(btn, account) {
    const res = await send({
      type: "status",
      platform: account.platform,
      platformId: account.platformId,
    });
    if (!res.ok) return paint(btn, "warn", "⚠ Inspo");
    if (!res.signedIn) return paint(btn, "", "➕ Sign in");
    if (res.saved) return paint(btn, "saved", `✓ ${res.folder}`);
    paint(btn, "", "➕ Inspo");
  }

  async function onClick(btn, account) {
    if (picker) return closePicker(); // second click closes it

    const state = await send({
      type: "status",
      platform: account.platform,
      platformId: account.platformId,
    });

    if (state.ok && !state.signedIn) {
      // Can't open the popup programmatically, so send them to the dashboard to sign in.
      await send({ type: "openDashboard" });
      return;
    }
    // Already saved: no write, just let them re-file it.
    if (state.ok && state.saved) return openPicker(btn, account, state.id, state.folderId, state.tier);

    paint(btn, "", "saving…");
    const res = await send({ type: "save", account });

    if (!res.ok) {
      paint(btn, "warn", "⚠ Retry");
      toast(res.error || "Save failed");
      return;
    }
    paint(btn, "saved", `✓ ${res.folder}`);
    return openPicker(btn, account, res.id, res.folderId ?? null, res.tier ?? null);
  }

  function attach() {
    if (!adapter.isSaveablePage(location.href)) return;
    if (document.getElementById(BTN_ID)) return;

    const anchor = adapter.findAnchor();
    if (!anchor) return;

    const account = adapter.readAccount();
    if (!account) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    paint(btn, "", "➕ Inspo");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(btn, account);
    });

    anchor.parentElement?.insertBefore(btn, anchor.nextSibling);
    refreshState(btn, account);
  }

  // ---------- picker ----------
  //
  // Anchored under the button, and it stays until dismissed. The old toast put the
  // filing decision on a 4-second timer, which is the thing this replaces.

  let picker = null;

  function closePicker() {
    if (!picker) return;
    picker.el.remove();
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onPickerKeydown, true);
    picker = null;
  }

  function onDocMouseDown(e) {
    if (!picker) return;
    if (picker.el.contains(e.target)) return;
    if (e.target.closest?.(`#${BTN_ID}`)) return; // the button toggles; onClick handles it
    closePicker();
  }

  function onPickerKeydown(e) {
    if (!picker || e.key !== "Escape") return;
    e.stopPropagation();
    // Escape backs out of naming a folder before it closes the whole panel.
    if (picker.creating) {
      picker.creating = false;
      picker.draft = "";
      picker.error = "";
      renderPicker();
    } else {
      closePicker();
    }
  }

  function positionPicker() {
    const r = picker.btn.getBoundingClientRect();
    const el = picker.el;
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 248))}px`;

    // Flip above the button when there isn't room below it.
    const below = window.innerHeight - r.bottom;
    if (below < 240 && r.top > below) {
      el.style.top = "auto";
      el.style.bottom = `${window.innerHeight - r.top + 6}px`;
    } else {
      el.style.bottom = "auto";
      el.style.top = `${r.bottom + 6}px`;
    }
  }

  function renderPicker() {
    const el = picker.el;
    el.textContent = "";

    // Tier chips. Setting one leaves the panel open — you usually still want to file it.
    const tiers = document.createElement("div");
    tiers.className = "tiers";
    tiers.append(Object.assign(document.createElement("span"), { className: "label", textContent: "Tier" }));
    for (const t of TIERS) {
      const chip = document.createElement("span");
      chip.className = `tier tier-${t}${picker.tier === t ? " on" : ""}`;
      chip.textContent = t;
      chip.title = picker.tier === t ? "Click again to clear" : `Rank ${t}`;
      chip.addEventListener("click", () => chooseTier(picker.tier === t ? null : t));
      tiers.append(chip);
    }
    el.append(tiers, Object.assign(document.createElement("div"), { className: "sep" }));

    const items = [...picker.folders.map((f) => ({ id: f.id, name: f.name })), { id: null, name: "Unsorted" }];

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "row";
      row.textContent = `📁 ${item.name}`;
      if (item.id === picker.folderId) {
        row.append(Object.assign(document.createElement("span"), { className: "tick", textContent: "✓" }));
      }
      row.addEventListener("click", () => chooseFolder(item.id, item.name));
      el.append(row);
    }

    el.append(Object.assign(document.createElement("div"), { className: "sep" }));

    if (picker.creating) {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "New folder name";
      input.value = picker.draft || "";
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        picker.draft = input.value;
        createAndFile(input.value);
      });
      el.append(input);
      input.focus();
      input.select();
    } else {
      const add = document.createElement("div");
      add.className = "row new";
      add.textContent = "+ New folder…";
      add.addEventListener("click", () => {
        picker.creating = true;
        picker.error = "";
        renderPicker();
      });
      el.append(add);
    }

    if (picker.error) {
      el.append(Object.assign(document.createElement("div"), { className: "err", textContent: picker.error }));
    }

    positionPicker();
  }

  async function chooseFolder(folderId, name) {
    if (folderId === picker.folderId) return closePicker(); // already there

    const res = await send({ type: "moveChannel", id: picker.savedId, folderId });
    if (!res.ok) {
      picker.error = res.error || "Couldn't move it";
      return renderPicker();
    }

    const btn = document.getElementById(BTN_ID);
    if (btn) paint(btn, "saved", `✓ ${name}`);
    closePicker();
  }

  async function chooseTier(tier) {
    const res = await send({ type: "setTier", id: picker.savedId, tier });
    if (!res.ok) {
      picker.error = res.error || "Couldn't set the tier";
      return renderPicker();
    }
    picker.tier = tier;
    picker.error = "";
    renderPicker();
  }

  async function createAndFile(rawName) {
    const name = String(rawName).trim();
    if (!name) return;

    if (folderNameTaken(picker.folders, name)) {
      picker.error = `You already have a folder called “${name}”`;
      return renderPicker();
    }

    const made = await send({ type: "createFolder", name });
    if (!made.ok) {
      picker.error = made.error || "Couldn't create the folder";
      return renderPicker();
    }

    // The folder exists now. Keep it even if the move below fails — it was asked
    // for, and undoing it would be another write that can fail too.
    picker.folders = [...picker.folders, made.folder];
    picker.creating = false;
    picker.draft = "";
    picker.error = "";

    const moved = await send({ type: "moveChannel", id: picker.savedId, folderId: made.folder.id });
    if (!moved.ok) {
      picker.error = moved.error || "Folder made, but the channel didn't move into it";
      return renderPicker();
    }

    picker.folderId = made.folder.id;
    const btn = document.getElementById(BTN_ID);
    if (btn) paint(btn, "saved", `✓ ${made.folder.name}`);
    closePicker();
  }

  async function openPicker(btn, account, savedId, folderId, tier) {
    closePicker();

    const res = await send({ type: "listFolders" });
    if (!res.ok) return toast(res.error || "Couldn't load your folders");

    const el = document.createElement("div");
    el.className = "yt-inspo-panel";
    document.body.append(el);

    picker = {
      el,
      btn,
      account,
      savedId,
      folderId: folderId ?? null,
      tier: tier ?? null,
      folders: res.folders || [],
      // First ever use: nothing to click but "+ New folder", so skip a step.
      creating: (res.folders || []).length === 0,
      draft: "",
      error: "",
    };

    renderPicker();
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onPickerKeydown, true);
  }

  // ---------- toast ----------
  // Errors only — filing happens in the picker.

  let toastEl = null;
  let toastTimer = null;

  function toast(message) {
    clearTimeout(toastTimer);
    toastEl?.remove();

    toastEl = document.createElement("div");
    toastEl.className = "yt-inspo-toast";
    toastEl.append(Object.assign(document.createElement("span"), { textContent: message }));

    document.body.append(toastEl);
    toastTimer = setTimeout(() => toastEl?.remove(), 4000);
  }

  // The popup asks us what account this tab is showing — we're the only one
  // who can read the page.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "readAccount") return false;
    sendResponse({ ok: true, account: adapter.readAccount() });
    return true;
  });

  // ---------- lifecycle ----------

  const retryAttach = () => {
    let tries = 0;
    const id = setInterval(() => {
      attach();
      if (++tries > 20 || document.getElementById(BTN_ID)) clearInterval(id);
    }, 300); // header can take a beat to render after navigation
  };

  adapter.onNavigate(() => {
    closePicker(); // it's anchored to a button that's about to be replaced
    document.getElementById(BTN_ID)?.remove();
    retryAttach();
  });

  // If the site rebuilds its header, our button goes with it — put it back.
  new MutationObserver(() => {
    if (!document.getElementById(BTN_ID)) attach();
  }).observe(document.body, { childList: true, subtree: true });

  retryAttach();
}
