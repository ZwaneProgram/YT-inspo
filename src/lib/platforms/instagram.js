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
const attrIn = (scope, sel, a) => scope?.querySelector(sel)?.getAttribute(a) || null;

/**
 * The one subtree that describes the account this page is about. Everything
 * below reads from this same root, so the anchor and the author can never
 * disagree the way they used to (findAnchor and readAccount each picked their
 * own subtree independently).
 *
 * Deliberate deviation from "falls back to main" for post/reel URLs: Instagram
 * can open a post as a dialog *over* an unrelated, still-mounted profile (e.g.
 * clicking into a post from a profile grid, or a Tagged-tab post) — `main` in
 * that case is the *previous* page's content, not the post's. Falling back to
 * it would repeat exactly the "wrong account" and "stale account" failures this
 * fix exists to remove, and inspo-ui.js's attach() only ever inserts the button
 * once per navigation (it no-ops while `#yt-inspo-btn` exists), so a bad early
 * read isn't self-correcting — it latches until the next navigation. So on a
 * post/reel URL this resolves from `dialog` or `article` only; if neither is
 * mounted yet, it returns null and the caller's poll loop tries again next
 * tick instead of risking a wrong or stale read. Profile URLs keep the full
 * main → document.body fallback — there's no "previous page" ambiguity there.
 */
function root() {
  if (isPostUrl(location.href)) {
    return document.querySelector("div[role='dialog']") || document.querySelector("article") || null;
  }
  return document.querySelector("main") || document.body;
}

/** The first link within `scope` whose href is a real profile URL. */
function authorLink(scope) {
  if (!scope) return null;
  for (const a of scope.querySelectorAll("a[href^='/']")) {
    if (usernameFromUrl(`https://www.instagram.com${a.getAttribute("href")}`)) return a;
  }
  return null;
}

/** The lowercase username `authorLink` points at, or null. */
function authorUsername(scope) {
  const a = authorLink(scope);
  return a ? usernameFromUrl(`https://www.instagram.com${a.getAttribute("href")}`) : null;
}

/** The Follow/Following/Message control within `scope`, or null. */
function actionControl(scope) {
  if (!scope) return null;
  for (const el of scope.querySelectorAll("button, div[role='button']")) {
    // offsetParent is spec'd null for fixed-positioned elements even when fully
    // visible — reel and modal-overlay controls are commonly fixed-positioned,
    // so that check misclassified them as hidden. getClientRects() isn't fooled.
    if (el.getClientRects().length === 0) continue;
    if (ACTION_WORDS.test(el.textContent.trim())) return el;
  }
  return null;
}

export function findAnchor() {
  const r = root();
  if (!r) return null;

  return (
    actionControl(r) ||
    // Once you already follow a post/reel's author, its header shows no
    // Follow/Message control at all — every ACTION_WORDS entry misses, and the
    // button would silently never appear. Anchor beside the author's name link
    // instead. Scoped to the same root as above, so this can never resolve to
    // the site's persistent top nav.
    (isPostUrl(location.href) ? authorLink(r) : null)
  );
}

export function readAccount() {
  const onPost = isPostUrl(location.href);
  const r = root();
  if (!r) return null;

  const anchor = actionControl(r) || (onPost ? authorLink(r) : null);
  const username = onPost ? authorUsername(r) : usernameFromUrl(location.href);

  // Fail safe: an anchor with no resolvable author (or the reverse) means this
  // root doesn't actually describe the current URL yet — say nothing rather
  // than save a half-read or previous-page account.
  if (!anchor || !username) return null;

  // og:title carries the display name on profile pages. On a post it describes the
  // post, not the author, so fall back to the username there.
  const title =
    (onPost ? null : titleFromOgTitle(attr('meta[property="og:title"]', "content"))) || username;

  // Scoped to root, not the document: Instagram's left nav renders the
  // logged-in user's own avatar with the same "…'s profile picture" alt text,
  // earlier in document order than main — a document-wide query would persist
  // your own avatar onto every saved account instead of the one being viewed.
  const avatarUrl =
    attrIn(r, `img[alt*="profile picture"]`, "src") ||
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
