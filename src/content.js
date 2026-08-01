// Injects the "+ Inspo" button next to Subscribe.
//
// YouTube is a single-page app: it swaps pages without reloading, and rebuilds
// header DOM on the fly. So we re-attach on navigation AND watch for the header
// being replaced under us.

(async () => {
  const { channelIdFromUrl, handleFromUrl, channelIdFromHtml, canonicalUrl, isSaveablePage } =
    await import(chrome.runtime.getURL("src/lib/parse.js"));

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
    const state = await send({ type: "status", ytChannelId: channel.ytChannelId });

    if (state.ok && !state.signedIn) {
      // Can't open the popup programmatically, so send them to the dashboard to sign in.
      await send({ type: "openDashboard" });
      return;
    }
    if (state.ok && state.saved) {
      toast(`Already saved — in ${state.folder}`, channel, null);
      return;
    }

    paint(btn, "", "saving…");
    const res = await send({ type: "save", channel });

    if (!res.ok) {
      paint(btn, "warn", "⚠ Retry");
      toast(res.error || "Save failed", channel, null);
      return;
    }
    paint(btn, "saved", `✓ ${res.folder}`);
    toast(`Saved`, channel, res.id);
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

  // ---------- toast ----------

  let toastEl = null;
  let toastTimer = null;

  async function toast(message, channel, savedId) {
    clearTimeout(toastTimer);
    toastEl?.remove();

    toastEl = document.createElement("div");
    toastEl.className = "yt-inspo-toast";
    toastEl.append(Object.assign(document.createElement("span"), { textContent: message }));

    // Only offer the folder picker on a fresh save — that's the moment it's useful.
    if (savedId) {
      const res = await send({ type: "listFolders" });
      const select = document.createElement("select");
      select.append(new Option("Unsorted", ""));
      for (const f of res.folders || []) select.append(new Option(f.name, f.id));
      select.addEventListener("change", async () => {
        await send({
          type: "moveChannel",
          id: savedId,
          folderId: select.value ? Number(select.value) : null,
        });
        const btn = document.getElementById(BTN_ID);
        if (btn) paint(btn, "saved", `✓ ${select.selectedOptions[0].textContent}`);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl?.remove(), 1200);
      });
      toastEl.append(select);
    }

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
    document.getElementById(BTN_ID)?.remove();
    retryAttach();
  });

  // If YouTube rebuilds the header, our button goes with it — put it back.
  new MutationObserver(() => {
    if (!document.getElementById(BTN_ID)) attach();
  }).observe(document.body, { childList: true, subtree: true });

  retryAttach();
})();
