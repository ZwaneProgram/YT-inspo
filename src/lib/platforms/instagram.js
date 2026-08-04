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

/**
 * The @handle inside Instagram's og:title, lowercased to compare against
 * usernameFromUrl. og:title is document-level and only updated *after*
 * Instagram flips the URL, so this is how readAccount() proves a profile-page
 * title/avatar read still describes the account the URL now points at, rather
 * than the one that was on screen a moment ago.
 */
export function handleFromOgTitle(og) {
  if (!og) return null;
  // Profile shape is `Name (@handle) • Instagram photos…` — the handle is the
  // LAST parenthesised group before the "•" (or end of string), not the first
  // one anywhere in the string. A display name can itself contain "(@x)", and
  // a profile-scoped post permalink (/<user>/p/<code>/, misread as a profile by
  // isPostUrl) carries the post's og:title, whose caption can too. Anchoring on
  // "• or end" is what tells those apart from the real profile handle: the
  // greedy `.*` forces the capture to the rightmost qualifying group, and a
  // caption mention — never followed by "•" or end of string — fails to match
  // at all, falling through to the "no evidence" path instead of a wrong one.
  const m = String(og).match(/^.*\(@([^)]+)\)\s*(?:•|$)/);
  return m ? m[1].trim().toLowerCase() : null;
}

// ---------- DOM ----------

// Instagram's class names are machine-generated and churn constantly, so none of
// the selectors below rely on one. The button is anchored by its text instead.
const ACTION_WORDS = /^(follow|following|follow back|requested|message)$/i;

const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || null;
const attrIn = (scope, sel, a) => scope?.querySelector(sel)?.getAttribute(a) || null;

// getClientRects() rather than offsetParent: offsetParent is spec'd null for
// fixed-positioned elements even when they're fully visible, and reel/modal
// overlay controls are commonly fixed-positioned. getClientRects() isn't fooled,
// and still returns empty for display:none and never-laid-out subtrees.
const visible = (el) => el.getClientRects().length > 0;

/** The post/reel shortcode a pathname points at, e.g. "/p/CxYz123/" → "CxYz123". */
function shortcode(pathname) {
  const m = /^\/(?:p|reel)\/([A-Za-z0-9_-]+)/.exec(String(pathname || ""));
  return m ? m[1] : null;
}

/**
 * How a link inside a candidate root can prove that root is the current post,
 * strongest first. Every tier is tried across every candidate before the next
 * tier is tried at all, so a weakly-proved candidate can never beat a
 * strongly-proved one.
 */
const SELF_LINK_PROOFS = [
  // The post's own timestamp ("2 DAYS AGO"), which is an <a> to its permalink
  // wrapping a <time>. Only the view *of* the post renders this.
  (a) => !!a.querySelector("time"),
  // Anything else that isn't a thumbnail. Grid tiles — a profile's post grid, a
  // Tagged tab, the "more posts from" row — are links wrapping an <img>, and
  // they're the one way a *stale* root can end up holding a link to the post
  // you just navigated to. Excluding them is what keeps this tier safe.
  (a) => !a.querySelector("img"),
];

/**
 * The one subtree that describes the account this page is about. Everything
 * below reads from this same root, so the anchor and the author can never
 * disagree the way they used to (findAnchor and readAccount each picked their
 * own subtree independently).
 *
 * On a post/reel URL the root has to *prove* it's about the current URL before
 * it's used. Instagram flips the URL before it swaps the DOM, and it keeps the
 * previous view mounted while it does: a post opened over a profile (a grid or
 * Tagged-tab click), a second post opened from inside the first one's modal, a
 * permalink opened from the home feed. In every one of those the previous
 * page's `main`/`article`/`dialog` is still there and will answer *consistently
 * and wrongly*. inspo-ui.js's attach() no-ops while `#yt-inspo-btn` exists and
 * never re-reads the account it captured, so a wrong read latches until the
 * next navigation — while returning null costs nothing, because the standing
 * MutationObserver calls attach() again on the next mutation. So: require a
 * link to this URL's own shortcode inside the candidate, and return null when
 * nothing qualifies. That's what makes it safe to keep `main` in the chain,
 * which is what a reel permalink (no <article>) needs.
 *
 * Profile URLs need no proof — the username comes from location.href, not from
 * here. `main` only, deliberately no document.body fallback: body is
 * document-wide by definition, which is how the left nav's own-avatar and the
 * "Suggested for you" row's Follow buttons got into range before.
 */
function root() {
  if (!isPostUrl(location.href)) return document.querySelector("main");

  const code = shortcode(location.pathname);
  if (!code) return null; // a /p/ or /reel/ URL with no shortcode — nothing to prove against

  // Most specific first, so the innermost view of the post wins over an outer
  // container that merely holds it. In a post modal <article> nests inside
  // div[role='dialog'], so article has to come first for the comment above to
  // be true; a stale article is rejected by the shortcode proof below anyway.
  const candidates = [
    ...document.querySelectorAll("article"),
    ...document.querySelectorAll("div[role='dialog']"),
    ...document.querySelectorAll("main"),
  ];
  // Substring, not an exact path: hrefs carry query strings (?img_index=1) and
  // sub-routes (/c/<comment-id>/), and a reel's own permalink link is sometimes
  // written /p/<code>/ instead of /reel/<code>/. The shortcode is random and
  // ~11 characters, so matching it alone is specific enough.
  const selfLink = `a[href*="/${code}"]`;

  for (const proves of SELF_LINK_PROOFS) {
    for (const candidate of candidates) {
      for (const a of candidate.querySelectorAll(selfLink)) {
        if (proves(a)) return candidate;
      }
    }
  }
  return null;
}

/**
 * The part of the root that carries the account's name, avatar and controls.
 * Preferring the header is what stops the lookups below from wandering into the
 * "Suggested for you" row Instagram renders inside `main` (whose Follow buttons
 * belong to *other* accounts), or into a post's captions, comments and
 * tagged-people links. Derived from the single root, so it can't reintroduce
 * the two-independent-subtrees problem. Falls back to the root itself when a
 * layout ships no <header>.
 */
function headerScope(r) {
  return r ? r.querySelector("header") || r : null;
}

/** The first *visible* link within `scope` whose href is a real profile URL. */
function authorLink(scope) {
  if (!scope) return null;
  for (const a of scope.querySelectorAll("a[href^='/']")) {
    // Same visibility filter as actionControl, for the same reason: inserting
    // the button beside a hidden link (a collapsed caption, an offscreen
    // carousel slide) leaves a button that exists but can't be seen — and
    // because it exists, both the retry poll and the standing observer stop.
    if (!visible(a)) continue;
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
    if (!visible(el)) continue;
    if (ACTION_WORDS.test(el.textContent.trim())) return el;
  }
  return null;
}

/**
 * The element the button is inserted beside. Both entry points go through this,
 * so findAnchor() and readAccount() cannot disagree about what was found.
 */
function anchorIn(scope, onPost) {
  if (!scope) return null;
  return (
    actionControl(scope) ||
    // Once you already follow a post/reel's author, its header shows no
    // Follow/Message control at all — every ACTION_WORDS entry misses, and the
    // button would silently never appear. Anchor beside the author's name link
    // instead. Same scope as above, so this can never resolve to the site's
    // persistent top nav.
    (onPost ? authorLink(scope) : null)
  );
}

// findAnchor() and readAccount() each resolve the root and the anchor for
// themselves rather than sharing a cached read. That's deliberate: attach() in
// inspo-ui.js calls them back to back with no await in between, so they see the
// same DOM, while the popup's readAccount() arrives arbitrarily later and must
// re-read the page rather than trust anything cached from an earlier attach.
export function findAnchor() {
  return anchorIn(headerScope(root()), isPostUrl(location.href));
}

export function readAccount() {
  const onPost = isPostUrl(location.href);
  const r = root();
  const scope = headerScope(r);

  // Where the username comes from decides how much proof is needed. On a
  // profile it comes from location.href — authoritative, and impossible to
  // stale — so the DOM is not allowed to veto it. Gating this on the anchor is
  // what broke the popup's Save card on your own profile ("Edit profile" is not
  // an ACTION_WORD) and on every non-English UI; the popup is the *designed*
  // fallback for exactly the pages where injection fails (PROJECT_NOTES.md,
  // "Two ways to save, on purpose").
  const username = onPost ? authorUsername(scope) : usernameFromUrl(location.href);
  if (!username) return null;

  // On a post/reel the username came out of the DOM, so it's only worth as much
  // as the root it came from. Keep the full fail-safe there: no anchor means no
  // account, rather than a half-read of a subtree that may still describe the
  // previous post.
  if (onPost && !anchorIn(scope, onPost)) return null;

  // og:title (and og:image, below) are document-level, and Instagram updates
  // them *after* it flips the URL. On profile→profile navigation React can
  // patch the existing header in place rather than destroy and rebuild it, so a
  // stale og:title can still describe the *previous* account for a beat after
  // location.href (and username, above) already agree on the new one. Require
  // the @handle inside og:title to match the URL's username before trusting
  // title or avatar — the profile-page counterpart of root()'s shortcode proof
  // for posts. A handle that disagrees means "stale, try again next mutation";
  // no parseable handle (og:title absent, or in a shape we don't recognise) is
  // not evidence of either way, so it falls through to today's `|| username`
  // fallback — regressing that would break the popup's Save card on pages where
  // the DOM can't be read at all ("Two ways to save, on purpose",
  // PROJECT_NOTES.md).
  const ogTitle = onPost ? null : attr('meta[property="og:title"]', "content");
  const ogHandle = ogTitle ? handleFromOgTitle(ogTitle) : null;
  if (ogHandle && ogHandle !== username) return null;

  const title = titleFromOgTitle(ogTitle) || username;

  // Probed from the header (or, failing that, the root) — never the document:
  // Instagram's left nav renders the logged-in user's own avatar with the same
  // "…'s profile picture" alt text, earlier in document order than main, so a
  // document-wide query would stamp your own face onto every account you save.
  // Header scoping is a preference, not a guarantee — on a layout with no
  // <header> this reads from the root, which on a profile is `main` and can also
  // hold the "Suggested for you" avatars. It can no longer reach the nav, which
  // is the failure that mattered. og:image is gated on the same og:title proof
  // above: it goes stale identically, and by the same timing.
  const avatarUrl =
    attrIn(scope, `img[alt*="profile picture"]`, "src") ||
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
