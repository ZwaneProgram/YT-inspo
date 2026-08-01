// Service worker. The content script can't import our modules or hold a session,
// so it asks this for everything.

import * as store from "./store.js";
import { getSession } from "./supabase.js";
import { folderName } from "./lib/parse.js";

const handlers = {
  async status({ ytChannelId }) {
    const session = await getSession();
    if (!session) return { signedIn: false };
    const { folders } = await store.readCache();
    const existing = ytChannelId ? await store.lookup(ytChannelId) : null;
    return {
      signedIn: true,
      saved: !!existing,
      folder: existing ? folderName(folders, existing.folder_id) : null,
    };
  },

  async save({ channel }) {
    const row = await store.saveChannel(channel);
    const { folders } = await store.readCache();
    return { saved: true, folder: folderName(folders, row.folder_id), id: row.id };
  },

  async listFolders() {
    const { folders } = await store.readCache();
    return { folders };
  },

  async moveChannel({ id, folderId }) {
    await store.moveChannels([id], folderId);
    return { ok: true };
  },

  async openDashboard() {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;

  handler(msg)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((e) => sendResponse({ ok: false, error: e.message, kind: e.kind || "error" }));

  return true; // keep the channel open for the async reply
});

// Warm the cache on install so the first popup open is instant too.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (await getSession()) await store.sync();
  } catch {
    /* not signed in yet, or offline — the popup will handle it */
  }
});
