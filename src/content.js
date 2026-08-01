// Injects the "+ Inspo" button next to Subscribe.
//
// YouTube is a single-page app: it swaps pages without reloading, and rebuilds
// header DOM on the fly. So we re-attach on navigation AND watch for the header
// being replaced under us.

(async () => {
  const {
    channelIdFromUrl, handleFromUrl, channelIdFromHtml, canonicalUrl, isSaveablePage,
    folderNameTaken,
  } = await import(chrome.runtime.getURL("src/lib/parse.js"));

  const BTN_ID = "yt-inspo-btn";

  // Ordered by preference. YouTube ships several header layouts; first hit wins.
  const SUBSCRIBE_SELECTORS = [
    "#owner #subscribe-button",                        // watch page
    "ytd-video-owner-renderer #subscribe-button",      // watch page (older)
    "yt-flexible-actions-view-model",                  // channel page (2024+)
    "#channel-header #subscribe-button",               // channel page
    "ytd-c4-tabbed-header-renderer #subscribe-button", // channel page (older)
    "#subscribe-button",                               // last resort
  ];

  const findAnchor = () => {
    for (const sel of SUBSCRIBE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  };

  // ---------- reading the channel off the page ----------

  const text = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
  const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || null;

  function readChannel() {
    const onWatch = location.pathname === "/watch" || location.pathname.startsWith("/shorts/");

    const ownerLink = onWatch
      ? attr("#owner #channel-name a, ytd-video-owner-renderer a[href]", "href")
      : location.pathname;

    const ytChannelId =
      channelIdFromUrl(ownerLink) ||
      channelIdFromUrl(attr('link[rel="canonical"]', "href")) ||
      channelIdFromHtml(document.documentElement.innerHTML);

    if (!ytChannelId) return null;

    const handle = handleFromUrl(ownerLink) || handleFromUrl(location.href);

    const title = onWatch
      ? text("#owner #channel-name a, ytd-video-owner-renderer #channel-name a")
      : text("yt-dynamic-text-view-model h1, #channel-name #text, #channel-header h1") ||
        attr('meta[property="og:title"]', "content");

    const avatarUrl = onWatch
      ? attr("#owner img, ytd-video-owner-renderer img", "src")
      : attr("yt-avatar-shape img, #channel-header img, #avatar img", "src") ||
        attr('meta[property="og:image"]', "content");

    if (!title) return null;

    return {
      ytChannelId,
      handle,
      title,
      avatarUrl,
      url: canonicalUrl({ handle, ytChannelId }),
    };
  }

  // ---------- the button ----------

  const send = (msg) =>
    new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false })));

  function paint(btn, state, label) {
    btn.className = `yt-inspo-btn ${state}`;
    btn.textContent = label;
  }

  async function refreshState(btn, channel) {
    const res = await send({ type: "status", ytChannelId: channel.ytChannelId });
    if (!res.ok) return paint(btn, "warn", "⚠ Inspo");
    if (!res.signedIn) return paint(btn, "", "➕ Sign in");
    if (res.saved) return paint(btn, "saved", `✓ ${res.folder}`);
    paint(btn, "", "➕ Inspo");
  }

  async function onClick(btn, channel) {
    if (picker) return closePicker(); // second click closes it

    const state = await send({ type: "status", ytChannelId: channel.ytChannelId });

    if (state.ok && !state.signedIn) {
      // Can't open the popup programmatically, so send them to the dashboard to sign in.
      await send({ type: "openDashboard" });
      return;
    }
    // Already saved: no write, just let them re-file it.
    if (state.ok && state.saved) return openPicker(btn, channel, state.id, state.folderId);

    paint(btn, "", "saving…");
    const res = await send({ type: "save", channel });

    if (!res.ok) {
      paint(btn, "warn", "⚠ Retry");
      toast(res.error || "Save failed");
      return;
    }
    paint(btn, "saved", `✓ ${res.folder}`);
    return openPicker(btn, channel, res.id, res.folderId ?? null);
  }

  function attach() {
    if (!isSaveablePage(location.href)) return;
    if (document.getElementById(BTN_ID)) return;

    const anchor = findAnchor();
    if (!anchor) return;

    const channel = readChannel();
    if (!channel) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    paint(btn, "", "➕ Inspo");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(btn, channel);
    });

    anchor.parentElement?.insertBefore(btn, anchor.nextSibling);
    refreshState(btn, channel);
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

  async function openPicker(btn, channel, savedId, folderId) {
    closePicker();

    const res = await send({ type: "listFolders" });
    if (!res.ok) return toast(res.error || "Couldn't load your folders");

    const el = document.createElement("div");
    el.className = "yt-inspo-panel";
    document.body.append(el);

    picker = {
      el,
      btn,
      channel,
      savedId,
      folderId: folderId ?? null,
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
  // Errors only now — filing happens in the picker.

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

  // The popup asks us what channel this tab is showing — we're the only one
  // who can read the page.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "readChannel") return false;
    sendResponse({ ok: true, channel: readChannel() });
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

  document.addEventListener("yt-navigate-finish", () => {
    closePicker(); // it's anchored to a button that's about to be replaced
    document.getElementById(BTN_ID)?.remove();
    retryAttach();
  });

  // If YouTube rebuilds the header, our button goes with it — put it back.
  new MutationObserver(() => {
    if (!document.getElementById(BTN_ID)) attach();
  }).observe(document.body, { childList: true, subtree: true });

  retryAttach();
})();
