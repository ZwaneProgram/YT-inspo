// Everything Instagram-specific. Same exports as platforms/youtube.js — see
// src/lib/inspo-ui.js for the adapter contract. The DOM half is added in Task 4.

export const platform = "instagram";

// Instagram's top-level routes that aren't usernames. This list is the Instagram
// equivalent of YouTube's SUBSCRIBE_SELECTORS: the first thing to check when the
// button shows up somewhere it shouldn't, or stops showing up where it should.
const RESERVED = new Set([
  "explore", "reels", "direct", "accounts", "p", "reel", "stories", "tv", "s",
  "challenge", "legal", "about", "developer", "api", "settings", "your_activity",
]);

const HOST = /^https:\/\/(www\.)?instagram\.com(\/|$)/;

/** First path segment of an instagram.com URL, or null. */
function firstSegment(url) {
  if (!url) return null;
  const u = String(url);
  if (!HOST.test(u)) return null;
  const path = u.replace(/^https:\/\/(www\.)?instagram\.com/, "").split(/[?#]/)[0];
  return path.split("/").filter(Boolean)[0] || null;
}

/**
 * The username a profile URL points at, lowercased — casing must not be able to
 * create a second row for the same person.
 */
export function usernameFromUrl(url) {
  const seg = firstSegment(url);
  if (!seg) return null;
  if (RESERVED.has(seg.toLowerCase())) return null;
  if (!/^[A-Za-z0-9._]+$/.test(seg)) return null;
  return seg.toLowerCase();
}

/** A single post or reel — the author is in the DOM, not the URL. */
export function isPostUrl(url) {
  const seg = firstSegment(url);
  return seg === "p" || seg === "reel";
}

/** Is this a page where saving an account makes sense? */
export function isSaveablePage(url) {
  return !!usernameFromUrl(url) || isPostUrl(url);
}

/** Canonical profile URL we store and open. */
export function canonicalUrl({ platformId }) {
  return platformId ? `https://www.instagram.com/${platformId}/` : null;
}

/**
 * Instagram's og:title reads `Andrew Price (@blenderguru) • Instagram photos…`.
 * The display name is the part before the parenthesised handle. More stable than
 * any header selector, which is why it's preferred over reading the DOM.
 */
export function titleFromOgTitle(og) {
  if (!og) return null;
  const m = String(og).match(/^\s*(.+?)\s*\(@[^)]+\)/);
  return m ? m[1].trim() : null;
}

// ---------- DOM ----------

// Instagram's class names are machine-generated and churn constantly, so none of
// the selectors below rely on one. The button is anchored by its text instead.
const ACTION_WORDS = /^(follow|following|follow back|requested|message)$/i;

const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || null;

function header() {
  return document.querySelector("main header") || document.querySelector("header");
}

/** The author link in a post or reel header, as a lowercase username. */
function authorFromPost() {
  const links = document.querySelectorAll(
    "article header a[href^='/'], main header a[href^='/']"
  );
  for (const a of links) {
    const username = usernameFromUrl(`https://www.instagram.com${a.getAttribute("href")}`);
    if (username) return username;
  }
  return null;
}

export function findAnchor() {
  const h = header();
  if (!h) return null;

  for (const el of h.querySelectorAll("button, div[role='button']")) {
    if (el.offsetParent === null) continue;
    if (ACTION_WORDS.test(el.textContent.trim())) return el;
  }
  return null;
}

export function readAccount() {
  const onPost = isPostUrl(location.href);
  const username = onPost ? authorFromPost() : usernameFromUrl(location.href);
  if (!username) return null;

  // og:title carries the display name on profile pages. On a post it describes the
  // post, not the author, so fall back to the username there.
  const title =
    (onPost ? null : titleFromOgTitle(attr('meta[property="og:title"]', "content"))) || username;

  const avatarUrl =
    attr(`img[alt*="profile picture"]`, "src") ||
    attr("main header img", "src") ||
    (onPost ? null : attr('meta[property="og:image"]', "content"));

  return {
    platform,
    platformId: username,
    handle: `@${username}`,
    title,
    avatarUrl,
    url: canonicalUrl({ platformId: username }),
  };
}

/**
 * Instagram fires no navigation event of its own, so watch for the URL changing
 * under us. Chosen over patching history.pushState, which is more precise but
 * rewrites a global on a page we don't own.
 */
export function onNavigate(cb) {
  let last = location.href;
  new MutationObserver(() => {
    if (location.href === last) return;
    last = location.href;
    cb();
  }).observe(document.body, { childList: true, subtree: true });
}
