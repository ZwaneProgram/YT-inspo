// Cache-first read layer.
//
// Supabase is the source of truth. chrome.storage.local holds a full copy so the
// popup can paint in ~0ms instead of waiting on the network. Reads hit the cache
// then refresh in the background; writes go to Supabase first, then patch the cache.

import * as db from "./supabase.js";
import { orphanChannels } from "./lib/parse.js";

const CACHE_KEY = "catalog";

// Bump when the shape of a cached row changes. A cache written by an older
// version holds fields the UI no longer reads — better to paint nothing for the
// few hundred ms until sync() returns than to paint rows full of undefined.
const CACHE_VERSION = 2;

const EMPTY = { version: CACHE_VERSION, folders: [], channels: [], syncedAt: 0 };

export async function readCache() {
  const { [CACHE_KEY]: c } = await chrome.storage.local.get(CACHE_KEY);
  if (!c || c.version !== CACHE_VERSION) return EMPTY;
  return c;
}

async function writeCache(patch) {
  const current = await readCache();
  const next = { ...current, ...patch, version: CACHE_VERSION };
  await chrome.storage.local.set({ [CACHE_KEY]: next });
  return next;
}

/** Pull everything fresh. Callers render the cache first, then re-render on this. */
export async function sync() {
  const [folders, channels] = await Promise.all([db.listFolders(), db.listChannels()]);
  return writeCache({ folders, channels, syncedAt: Date.now() });
}

/**
 * Render-now-refresh-later helper.
 * onData fires immediately with cache, then again with server data if it changed.
 */
export async function load(onData) {
  const cached = await readCache();
  onData(cached, { stale: true });
  try {
    const fresh = await sync();
    onData(fresh, { stale: false });
  } catch (e) {
    onData(cached, { stale: true, error: e });
  }
}

// ---------- writes ----------

export async function saveChannel(account) {
  const row = await db.upsertChannel(account);
  const { channels } = await readCache();
  const rest = channels.filter(
    (c) => !(c.platform === row.platform && c.platform_id === row.platform_id)
  );
  await writeCache({ channels: [row, ...rest] });
  return row;
}

export async function addFolder(name) {
  const { folders } = await readCache();
  const row = await db.createFolder(name, folders.length);
  await writeCache({ folders: [...folders, row] });
  return row;
}

export async function renameFolder(id, name) {
  await db.renameFolder(id, name);
  const { folders } = await readCache();
  await writeCache({ folders: folders.map((f) => (f.id === id ? { ...f, name } : f)) });
}

export async function removeFolder(id) {
  await db.deleteFolder(id);
  const { folders, channels } = await readCache();
  await writeCache({
    folders: folders.filter((f) => f.id !== id),
    channels: orphanChannels(channels, id),
  });
}

export async function moveChannels(ids, folderId) {
  await db.moveChannels(ids, folderId);
  const { channels } = await readCache();
  const set = new Set(ids);
  await writeCache({
    channels: channels.map((c) => (set.has(c.id) ? { ...c, folder_id: folderId } : c)),
  });
}

export async function removeChannels(ids) {
  await db.deleteChannels(ids);
  const { channels } = await readCache();
  const set = new Set(ids);
  await writeCache({ channels: channels.filter((c) => !set.has(c.id)) });
}

/** Already in the catalog? Answered from cache so the page button can react instantly. */
export async function lookup(platform, platformId) {
  const { channels } = await readCache();
  return channels.find((c) => c.platform === platform && c.platform_id === platformId) || null;
}
