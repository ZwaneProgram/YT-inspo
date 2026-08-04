// Everything YouTube-specific: URL parsing, header selectors, reading the page.
// The exports below are the platform adapter contract — see src/lib/inspo-ui.js.

export const platform = "youtube";

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
export function canonicalUrl({ handle, platformId }) {
  if (handle) return `https://www.youtube.com/${handle}`;
  if (platformId) return `https://www.youtube.com/channel/${platformId}`;
  return null;
}

/** Is this a page where saving a channel makes sense? */
export function isSaveablePage(url) {
  if (!url) return false;
  const u = String(url);
  if (!/^https:\/\/(www\.)?youtube\.com\//.test(u)) return false;
  return /\/watch\?|\/channel\/|\/@|\/shorts\//.test(u);
}

/** What the URL alone can tell us. Null on /@handle pages — those need the DOM. */
export function identityFromUrl(url) {
  const platformId = channelIdFromUrl(url);
  if (!platformId) return null;
  return { platformId, handle: handleFromUrl(url) };
}

// ---------- DOM ----------

// Ordered by preference. YouTube ships several header layouts; first hit wins.
const SUBSCRIBE_SELECTORS = [
  "#owner #subscribe-button",                        // watch page
  "ytd-video-owner-renderer #subscribe-button",      // watch page (older)
  "yt-flexible-actions-view-model",                  // channel page (2024+)
  "#channel-header #subscribe-button",               // channel page
  "ytd-c4-tabbed-header-renderer #subscribe-button", // channel page (older)
  "#subscribe-button",                               // last resort
];

export function findAnchor() {
  for (const sel of SUBSCRIBE_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

const text = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || null;

export function readAccount() {
  const onWatch = location.pathname === "/watch" || location.pathname.startsWith("/shorts/");

  const ownerLink = onWatch
    ? attr("#owner #channel-name a, ytd-video-owner-renderer a[href]", "href")
    : location.pathname;

  const platformId =
    channelIdFromUrl(ownerLink) ||
    channelIdFromUrl(attr('link[rel="canonical"]', "href")) ||
    channelIdFromHtml(document.documentElement.innerHTML);

  if (!platformId) return null;

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
    platform,
    platformId,
    handle,
    title,
    avatarUrl,
    url: canonicalUrl({ handle, platformId }),
  };
}

/** YouTube is a single-page app and tells us when it navigates. */
export function onNavigate(cb) {
  document.addEventListener("yt-navigate-finish", cb);
}
