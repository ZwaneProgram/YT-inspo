// Service worker. The content script can't import our modules or hold a session,
// so it asks this for everything.

import * as store from "./store.js";
import { getSession } from "./supabase.js";
import { folderName, friendlyWriteError } from "./lib/parse.js";

const handlers = {
  async status({ platform, platformId }) {
    const session = await getSession();
    if (!session) return { signedIn: false };
    const { folders } = await store.readCache();
    const existing = platformId ? await store.lookup(platform, platformId) : null;
    return {
      signedIn: true,
      saved: !!existing,
      folder: existing ? folderName(folders, existing.folder_id) : null,
      // The picker needs the row to move it, and its folder to tick the right line.
      id: existing ? existing.id : null,
      folderId: existing ? existing.folder_id ?? null : null,
    };
  },

  async save({ account }) {
    const row = await store.saveChannel(account);
    const { folders } = await store.readCache();
    return {
      saved: true,
      folder: folderName(folders, row.folder_id),
      id: row.id,
      folderId: row.folder_id ?? null,
    };
  },

  async listFolders() {
    const { folders } = await store.readCache();
    return { folders };
  },

  async createFolder({ name }) {
    try {
      return { folder: await store.addFolder(name) };
    } catch (e) {
      const err = new Error(friendlyWriteError(e.message));
      err.kind = e.kind;
      throw err;
    }
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
