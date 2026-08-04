// Pure helpers — no DOM, no network. These are the bits worth testing.

const UC = /(UC[A-Za-z0-9_-]{22})/;

/**
 * Pull a YouTube channel id out of a URL, if the URL carries one.
 * /@handle URLs don't, so those return null and the caller falls back to the page.
 */
export function channelIdFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
  return m ? m[1] : null;
}

/** Pull an @handle out of a URL. Returns e.g. "@blenderguru". */
export function handleFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/youtube\.com\/(@[A-Za-z0-9._-]+)/);
  return m ? m[1] : null;
}

/** Last-resort scrape: YouTube embeds "channelId":"UC..." in the page source. */
export function channelIdFromHtml(html) {
  if (!html) return null;
  const m = String(html).match(/"(?:channelId|externalChannelId|externalId)"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/);
  return m ? m[1] : (String(html).match(UC) || [null, null])[1];
}

/** Canonical channel URL we store and open. Prefers the handle — it's readable. */
export function canonicalUrl({ handle, ytChannelId }) {
  if (handle) return `https://www.youtube.com/${handle}`;
  if (ytChannelId) return `https://www.youtube.com/channel/${ytChannelId}`;
  return null;
}

/** Is this a page where saving a channel makes sense? */
export function isSaveablePage(url) {
  if (!url) return false;
  const u = String(url);
  if (!/^https:\/\/(www\.)?youtube\.com\//.test(u)) return false;
  return /\/watch\?|\/channel\/|\/@|\/shorts\//.test(u);
}

/**
 * Popup search. Typing searches every channel regardless of folder;
 * an empty query falls back to the folder filter.
 * folderId of "all" means no filter; null means the Unsorted pile.
 */
export function filterChannels(channels, query, folderId) {
  const q = (query || "").trim().toLowerCase();
  if (q) {
    return channels.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.handle || "").toLowerCase().includes(q)
    );
  }
  if (folderId === "all") return channels;
  return channels.filter((c) => (c.folder_id ?? null) === folderId);
}

/** Display name for a channel's folder. */
export function folderName(folders, folderId) {
  if (folderId === null || folderId === undefined) return "Unsorted";
  const f = folders.find((x) => x.id === folderId);
  return f ? f.name : "Unsorted";
}

/**
 * Deleting a folder must never delete the channels in it — they fall back
 * to Unsorted. The DB does this via ON DELETE SET NULL; this mirrors it in cache.
 */
export function orphanChannels(channels, deletedFolderId) {
  return channels.map((c) =>
    c.folder_id === deletedFolderId ? { ...c, folder_id: null } : c
  );
}

/**
 * Is this folder name already in use? Compared trimmed and case-insensitively —
 * deliberately stricter than the DB's `unique (user_id, name)`, which would happily
 * accept both "3D" and "3d". You don't want both.
 */
export function folderNameTaken(folders, name) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return false;
  return folders.some((f) => String(f.name ?? "").trim().toLowerCase() === wanted);
}

/**
 * supabase.js throws with the raw PostgREST body as the message. Turn the one
 * failure we can predict — a duplicate folder name — into plain English.
 */
export function friendlyWriteError(message) {
  const m = String(message ?? "");
  if (/23505|duplicate key/i.test(m)) return "You already have a folder with that name";
  return m || "Something went wrong";
}

/**
 * Where clicking a saved row should take you. `url` is stored on save, but a row
 * written by an older version may not have one — rebuild it from the platform key.
 */
export function accountUrl(row) {
  if (row?.url) return row.url;
  if (!row?.platform_id) return null;
  if (row.platform === "instagram") return `https://www.instagram.com/${row.platform_id}/`;
  return `https://www.youtube.com/channel/${row.platform_id}`;
}
