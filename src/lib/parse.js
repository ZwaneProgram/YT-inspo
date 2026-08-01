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
