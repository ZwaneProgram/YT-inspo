# Instagram Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the catalog hold Instagram accounts alongside YouTube channels, in the same folders, saved with the same one-click button.

**Architecture:** The `channels` table is re-keyed on `(platform, platform_id)` instead of `yt_channel_id`. The content script splits into a site-agnostic UI module (`inspo-ui.js`) driven by a per-platform adapter, so YouTube and Instagram share one copy of the button, picker and toast. The popup and dashboard gain a platform filter and per-row badges.

**Tech Stack:** Plain ES modules, Chrome MV3, Supabase over REST, `node --test`. No npm dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-08-04-instagram-support-design.md`

## Global Constraints

- **The Supabase migration has already been run** against the live project. The database has `platform_id` and `platform`; the code does not. Task 1 is what makes the extension work again — until it lands, the extension is broken. Do not re-run the migration SQL.
- **No npm install, no bundler, no new dependencies.** Everything is plain ES modules loaded directly by the browser.
- **Tests are `node --test` against pure functions only.** Anything that touches the DOM or the network goes on the manual checklist instead. Do not add a DOM mocking library.
- **`platform` is exactly `"youtube"` or `"instagram"`.** A database CHECK constraint enforces it; no other value can be written.
- **`platform_id` for Instagram is the lowercase username** with no `@`. `handle` is `@` + the same lowercase username.
- **Reload after every change:** `brave://extensions` → ↻ on the card. Content script changes also need the YouTube/Instagram tab refreshed.
- **Commit after every task.** The repo is on branch `master`.

---

### Task 1: Re-key the data layer on `(platform, platform_id)`

Restores a working YouTube-only extension against the already-migrated database. Nothing Instagram-specific yet.

**Files:**
- Modify: `schema.sql`
- Modify: `src/supabase.js:172-212`
- Modify: `src/store.js:10-16`, `:48-54`, `:94-98`
- Modify: `src/background.js:9-33`
- Modify: `src/content.js:38-73`, `:86`, `:96`, `:107`
- Modify: `src/popup/popup.js:99`, `:141`, `:212`
- Modify: `src/dashboard/dashboard.js:197`
- Modify: `src/lib/parse.js` (add `accountUrl`)
- Test: `tests/parse.test.js`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `parse.accountUrl(row) -> string` — where clicking a saved row goes
  - `store.lookup(platform, platformId) -> row | null`
  - `store.saveChannel(account) -> row` where `account` is `{ platform, platformId, handle, title, avatarUrl, url, folder_id? }`
  - `db.upsertChannel(account) -> row`
  - Background messages: `status { platform, platformId }`, `save { account }`
  - Row shape from the server: `{ id, folder_id, platform, platform_id, handle, title, avatar_url, url, created_at }`

- [ ] **Step 1: Write the failing test for `accountUrl`**

Add to the end of `tests/parse.test.js`:

```js
test("accountUrl prefers the stored url", () => {
  assert.equal(
    accountUrl({ platform: "youtube", platform_id: ID, url: "https://www.youtube.com/@x" }),
    "https://www.youtube.com/@x"
  );
});

test("accountUrl falls back to a platform-shaped url when none was stored", () => {
  assert.equal(
    accountUrl({ platform: "youtube", platform_id: ID, url: null }),
    `https://www.youtube.com/channel/${ID}`
  );
  assert.equal(
    accountUrl({ platform: "instagram", platform_id: "blenderguru", url: null }),
    "https://www.instagram.com/blenderguru/"
  );
});
```

And add `accountUrl` to the import block at the top of the same file:

```js
import {
  channelIdFromUrl,
  handleFromUrl,
  channelIdFromHtml,
  canonicalUrl,
  isSaveablePage,
  filterChannels,
  folderName,
  orphanChannels,
  folderNameTaken,
  friendlyWriteError,
  accountUrl,
} from "../src/lib/parse.js";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `SyntaxError: The requested module '../src/lib/parse.js' does not provide an export named 'accountUrl'`

- [ ] **Step 3: Add `accountUrl` to `src/lib/parse.js`**

Append to `src/lib/parse.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all tests green.

- [ ] **Step 5: Update `schema.sql` to describe the migrated shape**

Replace the `channels` table block and the index line (lines 12-31) with:

```sql
create table if not exists channels (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- Deleting a folder must NOT delete the channels in it: they fall back to
  -- Unsorted (folder_id null). That's what SET NULL buys us.
  folder_id     bigint references folders (id) on delete set null,

  -- 'youtube' or 'instagram'. platform_id is the UC… id or the lowercase
  -- Instagram username; the pair is what makes a row unique.
  platform      text not null default 'youtube',
  platform_id   text not null,

  handle        text,
  title         text not null,
  avatar_url    text,
  url           text,
  created_at    timestamptz not null default now(),

  constraint channels_platform_check check (platform in ('youtube', 'instagram')),

  -- One row per account per user. Re-saving updates instead of duplicating.
  constraint channels_user_platform_id_key unique (user_id, platform, platform_id)
);

create index if not exists channels_folder_idx   on channels (user_id, folder_id);
create index if not exists channels_platform_idx on channels (user_id, platform);
```

Then append at the very end of the file:

```sql
-- ---------------------------------------------------------------------------
-- Migration, run 2026-08-04. Only needed for a database created before then,
-- when the table was YouTube-only and keyed on yt_channel_id. A fresh install
-- gets the right shape from the create table above and should skip this.
-- ---------------------------------------------------------------------------
--
-- alter table channels rename column yt_channel_id to platform_id;
-- alter table channels add column platform text not null default 'youtube';
--
-- alter table channels drop constraint channels_user_id_yt_channel_id_key;
-- alter table channels add constraint channels_user_platform_id_key
--   unique (user_id, platform, platform_id);
-- alter table channels add constraint channels_platform_check
--   check (platform in ('youtube', 'instagram'));
--
-- create index if not exists channels_platform_idx on channels (user_id, platform);
```

- [ ] **Step 6: Re-key the network calls in `src/supabase.js`**

Replace lines 172-212 (from `export const listChannels` to the end of the file) with:

```js
export const listChannels = () =>
  api(
    "/channels?select=id,folder_id,platform,platform_id,handle,title,avatar_url,url,created_at" +
      "&order=created_at.desc"
  );

/**
 * Save an account. UNIQUE(user_id, platform, platform_id) means a re-save updates
 * the existing row rather than duplicating it.
 */
export async function upsertChannel(account) {
  const s = await validSession();
  const rows = await api("/channels?on_conflict=user_id,platform,platform_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: {
      user_id: s.user_id,
      folder_id: account.folder_id ?? null,
      platform: account.platform,
      platform_id: account.platformId,
      handle: account.handle ?? null,
      title: account.title,
      avatar_url: account.avatarUrl ?? null,
      url: account.url ?? null,
    },
  });
  return rows[0];
}

export const moveChannels = (ids, folderId) =>
  api(`/channels?id=in.(${ids.join(",")})`, {
    method: "PATCH",
    body: { folder_id: folderId },
  });

export const deleteChannels = (ids) =>
  api(`/channels?id=in.(${ids.join(",")})`, { method: "DELETE" });

export const findChannel = (platform, platformId) =>
  api(
    `/channels?platform=eq.${platform}&platform_id=eq.${platformId}` +
      "&select=id,folder_id,title&limit=1"
  );
```

- [ ] **Step 7: Version the cache and re-key lookups in `src/store.js`**

Replace lines 10-16:

```js
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
```

Replace `writeCache` (lines 18-23) so it stamps the version:

```js
async function writeCache(patch) {
  const current = await readCache();
  const next = { ...current, ...patch, version: CACHE_VERSION };
  await chrome.storage.local.set({ [CACHE_KEY]: next });
  return next;
}
```

Replace `saveChannel` (lines 48-54):

```js
export async function saveChannel(account) {
  const row = await db.upsertChannel(account);
  const { channels } = await readCache();
  const rest = channels.filter(
    (c) => !(c.platform === row.platform && c.platform_id === row.platform_id)
  );
  await writeCache({ channels: [row, ...rest] });
  return row;
}
```

Replace `lookup` (lines 94-98):

```js
/** Already in the catalog? Answered from cache so the page button can react instantly. */
export async function lookup(platform, platformId) {
  const { channels } = await readCache();
  return channels.find((c) => c.platform === platform && c.platform_id === platformId) || null;
}
```

- [ ] **Step 8: Update the message handlers in `src/background.js`**

Replace the `status` and `save` handlers (lines 9-33):

```js
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
```

- [ ] **Step 9: Make `src/content.js` speak the new shape**

In `readChannel()` (lines 38-73), rename the local and the returned field. Replace the `return` block at lines 66-73:

```js
    return {
      platform: "youtube",
      platformId: ytChannelId,
      handle,
      title,
      avatarUrl,
      url: canonicalUrl({ handle, ytChannelId }),
    };
```

Then update the three message sends:

- Line 86, in `refreshState`:
  ```js
    const res = await send({ type: "status", platform: channel.platform, platformId: channel.platformId });
  ```
- Line 96, in `onClick`:
  ```js
    const state = await send({ type: "status", platform: channel.platform, platformId: channel.platformId });
  ```
- Line 107, in `onClick`:
  ```js
    const res = await send({ type: "save", account: channel });
  ```

- [ ] **Step 10: Update `src/popup/popup.js`**

Line 3 — add `accountUrl` to the import:

```js
import { filterChannels, folderName, accountUrl } from "../lib/parse.js";
```

Line 99, in `renderSaveState`:

```js
  const existing = state.channels.find(
    (c) => c.platform === pageChannel.platform && c.platform_id === pageChannel.platformId
  );
```

Line 141, in the `save-folder` change handler — the same replacement:

```js
  const existing = state.channels.find(
    (c) => c.platform === pageChannel.platform && c.platform_id === pageChannel.platformId
  );
```

Line 212, in `open()`:

```js
function open(channel) {
  chrome.tabs.create({ url: accountUrl(channel) });
  window.close();
}
```

- [ ] **Step 11: Update `src/dashboard/dashboard.js`**

Line 3 — add `accountUrl` to the import:

```js
import { filterChannels, folderName, accountUrl } from "../lib/parse.js";
```

Line 197 — replace the hardcoded YouTube fallback in the row template:

```js
        <a href="${escapeHtml(accountUrl(c))}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>
```

- [ ] **Step 12: Run the tests**

Run: `npm test`
Expected: PASS, all tests green.

- [ ] **Step 13: Reload and verify against the live database**

Reload the extension at `brave://extensions`, then refresh a YouTube tab.

- Open the popup. Your existing channels list, with their folders. (First open may flash empty for a moment — that's the cache version bump forcing a resync. It should not stay empty.)
- Open a saved channel's YouTube page. The button reads `✓ <folder>`, not `➕ Inspo`.
- Save a channel you haven't saved before. It appears in the popup.
- Re-save a channel you already have. No duplicate row appears.

If the popup stays empty, the migration did not land — check **Supabase → Table Editor → channels** for a `platform` column before going further.

- [ ] **Step 14: Commit**

```bash
git add schema.sql src/supabase.js src/store.js src/background.js src/content.js src/popup/popup.js src/dashboard/dashboard.js src/lib/parse.js tests/parse.test.js
git commit -m "refactor: key channels on (platform, platform_id)"
```

---

### Task 2: Extract the platform adapter and shared content-script UI

Pure refactor. No behaviour change, no new features. YouTube must work exactly as before when this lands.

**Files:**
- Create: `src/lib/platforms/youtube.js`
- Create: `src/lib/inspo-ui.js`
- Create: `src/content-youtube.js`
- Create: `tests/youtube.test.js`
- Delete: `src/content.js`
- Modify: `src/lib/parse.js` (remove the YouTube-specific helpers)
- Modify: `src/popup/popup.js:84-86`
- Modify: `manifest.json`
- Modify: `tests/parse.test.js` (remove the moved cases)

**Interfaces:**
- Consumes: `parse.folderNameTaken`, `parse.accountUrl` from Task 1
- Produces: the **platform adapter contract**, which Task 4 implements a second time:
  - `platform: string`
  - `isSaveablePage(url) -> boolean`
  - `findAnchor() -> Element | null`
  - `readAccount() -> { platform, platformId, handle, title, avatarUrl, url } | null`
  - `onNavigate(cb) -> void`
- Also produces: `inspoUi.start(adapter) -> void`, and the content-script message `readAccount` (renamed from `readChannel`)

- [ ] **Step 1: Create `src/lib/platforms/youtube.js`**

Everything YouTube-specific, moved from `parse.js` and `content.js` unchanged except for the `ytChannelId` → `platformId` rename.

```js
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
```

- [ ] **Step 2: Strip the YouTube helpers out of `src/lib/parse.js`**

Delete lines 1-42 (the `UC` constant, `channelIdFromUrl`, `handleFromUrl`, `channelIdFromHtml`, `canonicalUrl`, `isSaveablePage`) and replace with just the file comment:

```js
// Pure helpers with no DOM, no network and no platform knowledge.
// Anything site-specific lives in src/lib/platforms/. These are the bits worth testing.
```

Leave `filterChannels`, `folderName`, `orphanChannels`, `folderNameTaken`, `friendlyWriteError` and `accountUrl` exactly as they are.

- [ ] **Step 3: Move the YouTube test cases into `tests/youtube.test.js`**

Create `tests/youtube.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  channelIdFromUrl,
  handleFromUrl,
  channelIdFromHtml,
  canonicalUrl,
  isSaveablePage,
} from "../src/lib/platforms/youtube.js";

const ID = "UCabcdefghijklmnopqrstuv"; // UC + 22 chars

test("channelIdFromUrl pulls the id out of /channel/ URLs", () => {
  assert.equal(channelIdFromUrl(`https://www.youtube.com/channel/${ID}`), ID);
  assert.equal(channelIdFromUrl(`/channel/${ID}/videos`), ID);
});

test("channelIdFromUrl returns null for handle URLs and junk", () => {
  assert.equal(channelIdFromUrl("https://www.youtube.com/@blenderguru"), null);
  assert.equal(channelIdFromUrl("https://www.youtube.com/watch?v=abc"), null);
  assert.equal(channelIdFromUrl(null), null);
});

test("handleFromUrl pulls @handles", () => {
  assert.equal(handleFromUrl("https://www.youtube.com/@blenderguru"), "@blenderguru");
  assert.equal(handleFromUrl("https://www.youtube.com/@some.channel_1/videos"), "@some.channel_1");
  assert.equal(handleFromUrl(`https://www.youtube.com/channel/${ID}`), null);
});

test("channelIdFromHtml finds the id embedded in page source", () => {
  assert.equal(channelIdFromHtml(`{"channelId":"${ID}","x":1}`), ID);
  assert.equal(channelIdFromHtml(`"externalChannelId": "${ID}"`), ID);
  assert.equal(channelIdFromHtml("no ids here"), null);
});

test("canonicalUrl prefers the readable handle", () => {
  assert.equal(
    canonicalUrl({ handle: "@blenderguru", platformId: ID }),
    "https://www.youtube.com/@blenderguru"
  );
  assert.equal(
    canonicalUrl({ handle: null, platformId: ID }),
    `https://www.youtube.com/channel/${ID}`
  );
  assert.equal(canonicalUrl({}), null);
});

test("isSaveablePage accepts channel, video and shorts pages only", () => {
  assert.equal(isSaveablePage("https://www.youtube.com/@blenderguru"), true);
  assert.equal(isSaveablePage(`https://www.youtube.com/channel/${ID}`), true);
  assert.equal(isSaveablePage("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isSaveablePage("https://www.youtube.com/shorts/abc"), true);

  assert.equal(isSaveablePage("https://www.youtube.com/feed/subscriptions"), false);
  assert.equal(isSaveablePage("https://www.youtube.com/"), false);
  assert.equal(isSaveablePage("https://google.com/@x"), false);
});
```

- [ ] **Step 4: Trim `tests/parse.test.js` to the platform-agnostic cases**

Replace the import block (lines 1-17) with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  filterChannels,
  folderName,
  orphanChannels,
  folderNameTaken,
  friendlyWriteError,
  accountUrl,
} from "../src/lib/parse.js";

const ID = "UCabcdefghijklmnopqrstuv"; // UC + 22 chars
```

Then delete the six moved tests — `channelIdFromUrl` (both), `handleFromUrl`, `channelIdFromHtml`, `canonicalUrl`, `isSaveablePage` — along with the `// ---` separator comment that followed them. Everything from `const channels = [` downward stays.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. Same total number of assertions as before — nothing was dropped, only moved.

- [ ] **Step 6: Create `src/lib/inspo-ui.js`**

This is `content.js` with the YouTube parts replaced by `adapter.*` calls. Everything else — the picker, the toast, the retry loop — is copied verbatim.

```js
// The ➕ Inspo button, the folder picker and the error toast.
//
// Knows nothing about YouTube or Instagram: a platform adapter supplies
// `platform`, `isSaveablePage(url)`, `findAnchor()`, `readAccount()` and
// `onNavigate(cb)`. See src/lib/platforms/ for the two implementations.

import { folderNameTaken } from "./parse.js";

const BTN_ID = "yt-inspo-btn";

export function start(adapter) {
  const send = (msg) =>
    new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false })));

  // ---------- the button ----------

  function paint(btn, state, label) {
    btn.className = `yt-inspo-btn ${state}`;
    btn.textContent = label;
  }

  async function refreshState(btn, account) {
    const res = await send({
      type: "status",
      platform: account.platform,
      platformId: account.platformId,
    });
    if (!res.ok) return paint(btn, "warn", "⚠ Inspo");
    if (!res.signedIn) return paint(btn, "", "➕ Sign in");
    if (res.saved) return paint(btn, "saved", `✓ ${res.folder}`);
    paint(btn, "", "➕ Inspo");
  }

  async function onClick(btn, account) {
    if (picker) return closePicker(); // second click closes it

    const state = await send({
      type: "status",
      platform: account.platform,
      platformId: account.platformId,
    });

    if (state.ok && !state.signedIn) {
      // Can't open the popup programmatically, so send them to the dashboard to sign in.
      await send({ type: "openDashboard" });
      return;
    }
    // Already saved: no write, just let them re-file it.
    if (state.ok && state.saved) return openPicker(btn, account, state.id, state.folderId);

    paint(btn, "", "saving…");
    const res = await send({ type: "save", account });

    if (!res.ok) {
      paint(btn, "warn", "⚠ Retry");
      toast(res.error || "Save failed");
      return;
    }
    paint(btn, "saved", `✓ ${res.folder}`);
    return openPicker(btn, account, res.id, res.folderId ?? null);
  }

  function attach() {
    if (!adapter.isSaveablePage(location.href)) return;
    if (document.getElementById(BTN_ID)) return;

    const anchor = adapter.findAnchor();
    if (!anchor) return;

    const account = adapter.readAccount();
    if (!account) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    paint(btn, "", "➕ Inspo");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(btn, account);
    });

    anchor.parentElement?.insertBefore(btn, anchor.nextSibling);
    refreshState(btn, account);
  }

  // ---------- picker ----------
  //
  // Anchored under the button, and it stays until dismissed. The old toast put the
  // filing decision on a 4-second timer, which is the thing this replaces.

  let picker = null;

  function closePicker() {
    if (!picker) return;
    picker.el.remove();
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onPickerKeydown, true);
    picker = null;
  }

  function onDocMouseDown(e) {
    if (!picker) return;
    if (picker.el.contains(e.target)) return;
    if (e.target.closest?.(`#${BTN_ID}`)) return; // the button toggles; onClick handles it
    closePicker();
  }

  function onPickerKeydown(e) {
    if (!picker || e.key !== "Escape") return;
    e.stopPropagation();
    // Escape backs out of naming a folder before it closes the whole panel.
    if (picker.creating) {
      picker.creating = false;
      picker.draft = "";
      picker.error = "";
      renderPicker();
    } else {
      closePicker();
    }
  }

  function positionPicker() {
    const r = picker.btn.getBoundingClientRect();
    const el = picker.el;
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 248))}px`;

    // Flip above the button when there isn't room below it.
    const below = window.innerHeight - r.bottom;
    if (below < 240 && r.top > below) {
      el.style.top = "auto";
      el.style.bottom = `${window.innerHeight - r.top + 6}px`;
    } else {
      el.style.bottom = "auto";
      el.style.top = `${r.bottom + 6}px`;
    }
  }

  function renderPicker() {
    const el = picker.el;
    el.textContent = "";

    const items = [...picker.folders.map((f) => ({ id: f.id, name: f.name })), { id: null, name: "Unsorted" }];

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "row";
      row.textContent = `📁 ${item.name}`;
      if (item.id === picker.folderId) {
        row.append(Object.assign(document.createElement("span"), { className: "tick", textContent: "✓" }));
      }
      row.addEventListener("click", () => chooseFolder(item.id, item.name));
      el.append(row);
    }

    el.append(Object.assign(document.createElement("div"), { className: "sep" }));

    if (picker.creating) {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "New folder name";
      input.value = picker.draft || "";
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        picker.draft = input.value;
        createAndFile(input.value);
      });
      el.append(input);
      input.focus();
      input.select();
    } else {
      const add = document.createElement("div");
      add.className = "row new";
      add.textContent = "+ New folder…";
      add.addEventListener("click", () => {
        picker.creating = true;
        picker.error = "";
        renderPicker();
      });
      el.append(add);
    }

    if (picker.error) {
      el.append(Object.assign(document.createElement("div"), { className: "err", textContent: picker.error }));
    }

    positionPicker();
  }

  async function chooseFolder(folderId, name) {
    if (folderId === picker.folderId) return closePicker(); // already there

    const res = await send({ type: "moveChannel", id: picker.savedId, folderId });
    if (!res.ok) {
      picker.error = res.error || "Couldn't move it";
      return renderPicker();
    }

    const btn = document.getElementById(BTN_ID);
    if (btn) paint(btn, "saved", `✓ ${name}`);
    closePicker();
  }

  async function createAndFile(rawName) {
    const name = String(rawName).trim();
    if (!name) return;

    if (folderNameTaken(picker.folders, name)) {
      picker.error = `You already have a folder called “${name}”`;
      return renderPicker();
    }

    const made = await send({ type: "createFolder", name });
    if (!made.ok) {
      picker.error = made.error || "Couldn't create the folder";
      return renderPicker();
    }

    // The folder exists now. Keep it even if the move below fails — it was asked
    // for, and undoing it would be another write that can fail too.
    picker.folders = [...picker.folders, made.folder];
    picker.creating = false;
    picker.draft = "";
    picker.error = "";

    const moved = await send({ type: "moveChannel", id: picker.savedId, folderId: made.folder.id });
    if (!moved.ok) {
      picker.error = moved.error || "Folder made, but the channel didn't move into it";
      return renderPicker();
    }

    picker.folderId = made.folder.id;
    const btn = document.getElementById(BTN_ID);
    if (btn) paint(btn, "saved", `✓ ${made.folder.name}`);
    closePicker();
  }

  async function openPicker(btn, account, savedId, folderId) {
    closePicker();

    const res = await send({ type: "listFolders" });
    if (!res.ok) return toast(res.error || "Couldn't load your folders");

    const el = document.createElement("div");
    el.className = "yt-inspo-panel";
    document.body.append(el);

    picker = {
      el,
      btn,
      account,
      savedId,
      folderId: folderId ?? null,
      folders: res.folders || [],
      // First ever use: nothing to click but "+ New folder", so skip a step.
      creating: (res.folders || []).length === 0,
      draft: "",
      error: "",
    };

    renderPicker();
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onPickerKeydown, true);
  }

  // ---------- toast ----------
  // Errors only — filing happens in the picker.

  let toastEl = null;
  let toastTimer = null;

  function toast(message) {
    clearTimeout(toastTimer);
    toastEl?.remove();

    toastEl = document.createElement("div");
    toastEl.className = "yt-inspo-toast";
    toastEl.append(Object.assign(document.createElement("span"), { textContent: message }));

    document.body.append(toastEl);
    toastTimer = setTimeout(() => toastEl?.remove(), 4000);
  }

  // The popup asks us what account this tab is showing — we're the only one
  // who can read the page.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "readAccount") return false;
    sendResponse({ ok: true, account: adapter.readAccount() });
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

  adapter.onNavigate(() => {
    closePicker(); // it's anchored to a button that's about to be replaced
    document.getElementById(BTN_ID)?.remove();
    retryAttach();
  });

  // If the site rebuilds its header, our button goes with it — put it back.
  new MutationObserver(() => {
    if (!document.getElementById(BTN_ID)) attach();
  }).observe(document.body, { childList: true, subtree: true });

  retryAttach();
}
```

- [ ] **Step 7: Create `src/content-youtube.js` and delete `src/content.js`**

```js
// Content scripts can't use static imports, so pull the modules in dynamically
// and hand the adapter to the shared UI.

(async () => {
  const [adapter, ui] = await Promise.all([
    import(chrome.runtime.getURL("src/lib/platforms/youtube.js")),
    import(chrome.runtime.getURL("src/lib/inspo-ui.js")),
  ]);
  ui.start(adapter);
})();
```

Then: `git rm src/content.js`

- [ ] **Step 8: Point the manifest at the new file and widen the resource glob**

In `manifest.json`, replace `"js": ["src/content.js"]` with `"js": ["src/content-youtube.js"]`.

Then replace the `web_accessible_resources` block — `src/lib/*.js` does not match the new `platforms/` subdirectory:

```json
  "web_accessible_resources": [
    {
      "resources": ["src/lib/*.js", "src/lib/platforms/*.js"],
      "matches": ["https://www.youtube.com/*"]
    }
  ],
```

- [ ] **Step 9: Rename the popup's content-script message**

In `src/popup/popup.js`, `detectPageChannel` (lines 84-90):

```js
  const res = await chrome.tabs
    .sendMessage(tab.id, { type: "readAccount" })
    .catch(() => null); // content script not on this page — fine, no save card

  if (!res?.account) return;

  pageChannel = res.account;
```

- [ ] **Step 10: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Reload and verify YouTube is unchanged**

Reload the extension, refresh a YouTube tab, and walk the existing checklist:

- Button appears on a channel page (`/@handle`)
- Button appears on a video page
- Button appears after navigating between videos without a page reload
- Clicking it opens the picker; choosing a folder repaints the button
- `+ New folder…` creates and files
- Escape and outside-click close the picker
- Popup's Save card still detects the channel on the current tab

Any difference from before this task is a bug in the extraction, not a feature.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: split content script into platform adapter + shared UI"
```

---

### Task 3: Instagram URL parsing (pure logic)

**Files:**
- Create: `src/lib/platforms/instagram.js` (pure exports only — the DOM half comes in Task 4)
- Create: `tests/instagram.test.js`

**Interfaces:**
- Consumes: the adapter contract defined in Task 2
- Produces:
  - `usernameFromUrl(url) -> string | null` — lowercase, no `@`
  - `isPostUrl(url) -> boolean`
  - `isSaveablePage(url) -> boolean`
  - `canonicalUrl({ platformId }) -> string | null`
  - `titleFromOgTitle(og) -> string | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/instagram.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  usernameFromUrl,
  isPostUrl,
  isSaveablePage,
  canonicalUrl,
  titleFromOgTitle,
} from "../src/lib/platforms/instagram.js";

const IG = "https://www.instagram.com";

test("usernameFromUrl reads the first path segment", () => {
  assert.equal(usernameFromUrl(`${IG}/blenderguru`), "blenderguru");
  assert.equal(usernameFromUrl(`${IG}/blenderguru/`), "blenderguru");
  assert.equal(usernameFromUrl(`${IG}/blenderguru/?hl=en`), "blenderguru");
  assert.equal(usernameFromUrl(`${IG}/blenderguru/tagged/`), "blenderguru");
  assert.equal(usernameFromUrl(`${IG}/blenderguru#anchor`), "blenderguru");
  assert.equal(usernameFromUrl("https://instagram.com/blenderguru"), "blenderguru");
});

test("usernameFromUrl lowercases, so casing can't create a duplicate row", () => {
  assert.equal(usernameFromUrl(`${IG}/BlenderGuru`), "blenderguru");
  assert.equal(usernameFromUrl(`${IG}/blenderguru`), usernameFromUrl(`${IG}/BLENDERGURU`));
});

test("usernameFromUrl accepts dots and underscores, rejects other characters", () => {
  assert.equal(usernameFromUrl(`${IG}/some.name_1`), "some.name_1");
  assert.equal(usernameFromUrl(`${IG}/not a name`), null);
});

test("usernameFromUrl rejects reserved routes", () => {
  for (const route of [
    "explore", "reels", "direct", "accounts", "p", "reel", "stories", "tv",
    "s", "challenge", "legal", "about", "developer", "api", "settings",
    "your_activity",
  ]) {
    assert.equal(usernameFromUrl(`${IG}/${route}/`), null, `${route} is not a username`);
  }
});

test("usernameFromUrl rejects the site root and other hosts", () => {
  assert.equal(usernameFromUrl(`${IG}/`), null);
  assert.equal(usernameFromUrl(IG), null);
  assert.equal(usernameFromUrl("https://example.com/blenderguru"), null);
  assert.equal(usernameFromUrl(null), null);
});

test("isPostUrl recognises posts and reels", () => {
  assert.equal(isPostUrl(`${IG}/p/CxYz123/`), true);
  assert.equal(isPostUrl(`${IG}/reel/CxYz123/`), true);
  assert.equal(isPostUrl(`${IG}/reels/`), false, "the reels feed is not a single reel");
  assert.equal(isPostUrl(`${IG}/blenderguru/`), false);
});

test("isSaveablePage accepts profiles, posts and reels only", () => {
  assert.equal(isSaveablePage(`${IG}/blenderguru/`), true);
  assert.equal(isSaveablePage(`${IG}/p/CxYz123/`), true);
  assert.equal(isSaveablePage(`${IG}/reel/CxYz123/`), true);

  assert.equal(isSaveablePage(`${IG}/`), false);
  assert.equal(isSaveablePage(`${IG}/explore/`), false);
  assert.equal(isSaveablePage(`${IG}/reels/`), false);
  assert.equal(isSaveablePage(`${IG}/direct/inbox/`), false);
  assert.equal(isSaveablePage("https://www.youtube.com/@x"), false);
});

test("canonicalUrl builds the profile URL", () => {
  assert.equal(canonicalUrl({ platformId: "blenderguru" }), `${IG}/blenderguru/`);
  assert.equal(canonicalUrl({}), null);
});

test("titleFromOgTitle pulls the display name out of Instagram's og:title", () => {
  assert.equal(
    titleFromOgTitle("Andrew Price (@blenderguru) • Instagram photos and videos"),
    "Andrew Price"
  );
  assert.equal(titleFromOgTitle("Andrew Price (@blenderguru)"), "Andrew Price");
  assert.equal(titleFromOgTitle("no parenthesised handle here"), null);
  assert.equal(titleFromOgTitle(null), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/instagram.test.js`
Expected: FAIL — `Cannot find module .../src/lib/platforms/instagram.js`

- [ ] **Step 3: Write `src/lib/platforms/instagram.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/instagram.test.js`
Expected: PASS, 9 tests.

Then run the whole suite: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platforms/instagram.js tests/instagram.test.js
git commit -m "feat: Instagram URL parsing"
```

---

### Task 4: Instagram page reading and content script

**Files:**
- Modify: `src/lib/platforms/instagram.js` (append the DOM half)
- Create: `src/content-instagram.js`
- Modify: `manifest.json`
- Modify: `src/popup/popup.js:82`

**Interfaces:**
- Consumes: `usernameFromUrl`, `isPostUrl`, `canonicalUrl`, `titleFromOgTitle`, `platform` from Task 3; `inspoUi.start(adapter)` from Task 2
- Produces: `findAnchor()`, `readAccount()`, `onNavigate(cb)` completing the Instagram adapter

- [ ] **Step 1: Append the DOM half to `src/lib/platforms/instagram.js`**

Instagram's class names are generated and change constantly, so nothing here selects on one. Anchoring goes by button text, and the author of a post is found by looking for a header link whose href parses as a username.

```js
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
```

- [ ] **Step 2: Create `src/content-instagram.js`**

```js
// Content scripts can't use static imports, so pull the modules in dynamically
// and hand the adapter to the shared UI.

(async () => {
  const [adapter, ui] = await Promise.all([
    import(chrome.runtime.getURL("src/lib/platforms/instagram.js")),
    import(chrome.runtime.getURL("src/lib/inspo-ui.js")),
  ]);
  ui.start(adapter);
})();
```

- [ ] **Step 3: Register Instagram in `manifest.json`**

Replace the whole file:

```json
{
  "manifest_version": 3,
  "name": "Inspo",
  "version": "0.2.0",
  "description": "Catalog the YouTube channels and Instagram accounts you raid for editing ideas. One click to save, two to find.",

  "permissions": ["storage", "scripting", "activeTab"],
  "host_permissions": [
    "https://*.youtube.com/*",
    "https://*.instagram.com/*",
    "https://*.supabase.co/*"
  ],

  "background": {
    "service_worker": "src/background.js",
    "type": "module"
  },

  "action": {
    "default_popup": "src/popup/popup.html",
    "default_title": "Inspo"
  },

  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/*"],
      "js": ["src/content-youtube.js"],
      "css": ["src/content.css"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.instagram.com/*"],
      "js": ["src/content-instagram.js"],
      "css": ["src/content.css"],
      "run_at": "document_idle"
    }
  ],

  "web_accessible_resources": [
    {
      "resources": ["src/lib/*.js", "src/lib/platforms/*.js"],
      "matches": ["https://www.youtube.com/*", "https://www.instagram.com/*"]
    }
  ],

  "commands": {
    "_execute_action": {
      "suggested_key": { "default": "Ctrl+Shift+Y" },
      "description": "Open Inspo"
    }
  }
}
```

- [ ] **Step 4: Let the popup's Save card see Instagram tabs**

`src/popup/popup.js`, line 82 — the guard currently only lets YouTube through:

```js
  if (!/^https:\/\/(www\.)?(youtube|instagram)\.com\//.test(tab?.url || "")) return;
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. Nothing added here is testable in Node — this step is just confirming Task 3's work still holds.

- [ ] **Step 6: Reload and walk the Instagram checklist**

Reload the extension, then open Instagram in a fresh tab.

- Button appears on a profile, next to Follow / Following / Message
- Clicking it saves, and the picker opens anchored under it
- The saved title is the display name, not the username
- Button appears on a reel (`/reel/…`) and saves the **author**, not the reel
- Button appears on a post (`/p/…`)
- Navigate profile → reel → profile without reloading; the button survives each hop
- Button does **not** appear on `/`, `/explore/`, `/reels/`, `/direct/inbox/`
- The saved account shows up in the popup, in the same folder list as YouTube
- Clicking it in the popup opens `instagram.com/<username>/`
- YouTube still works exactly as it did

If the button doesn't attach on profiles, check `findAnchor` first — Instagram localises button text, and `ACTION_WORDS` only covers English.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: save Instagram accounts from profiles, posts and reels"
```

---

### Task 5: Platform filtering in `filterChannels`

**Files:**
- Modify: `src/lib/parse.js` (`filterChannels`, plus a new `platformBadge`)
- Modify: `tests/parse.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `filterChannels(channels, query, folderId, platform = "all") -> rows`
  - `platformBadge(platform) -> string` — `"▶"`, `"📷"` or `""`

- [ ] **Step 1: Write the failing tests**

In `tests/parse.test.js`, replace the `const channels = [...]` fixture so rows carry a platform:

```js
const channels = [
  { id: 1, title: "Blender Guru", handle: "@blenderguru", folder_id: 10, platform: "youtube" },
  { id: 2, title: "Alan Becker", handle: "@alanbecker", folder_id: 20, platform: "youtube" },
  { id: 3, title: "Some Guy", handle: "@someguy", folder_id: null, platform: "youtube" },
  { id: 4, title: "Reel Editor", handle: "@reeleditor", folder_id: 10, platform: "instagram" },
];
```

Two existing tests assume the fixture has three rows, all in folder 10 or below. Both need updating or they will fail.

`filterChannels: empty query falls back to the folder filter` — the new row is also in folder 10:

```js
test("filterChannels: empty query falls back to the folder filter", () => {
  assert.deepEqual(filterChannels(channels, "", 10).map((c) => c.id), [1, 4]);
  assert.deepEqual(filterChannels(channels, "   ", "all").map((c) => c.id), [1, 2, 3, 4]);
});
```

`orphanChannels moves a deleted folder's channels to Unsorted, keeping them` — it counts rows and folder 10 now holds two of them:

```js
test("orphanChannels moves a deleted folder's channels to Unsorted, keeping them", () => {
  const after = orphanChannels(channels, 10);
  assert.equal(after.length, 4, "no channel is lost when a folder is deleted");
  assert.equal(after.find((c) => c.id === 1).folder_id, null);
  assert.equal(after.find((c) => c.id === 4).folder_id, null, "across platforms too");
  assert.equal(after.find((c) => c.id === 2).folder_id, 20, "other folders untouched");
});
```

The other three (`a query searches every folder`, `matches on handle too`, `null folder is the Unsorted pile`) still pass unchanged — check, don't assume.

Then add the new cases:

```js
test("filterChannels: a platform narrows the list", () => {
  assert.deepEqual(
    filterChannels(channels, "", "all", "instagram").map((c) => c.id),
    [4]
  );
  assert.deepEqual(
    filterChannels(channels, "", "all", "youtube").map((c) => c.id),
    [1, 2, 3]
  );
});

test("filterChannels: 'all' means no platform filter, and is the default", () => {
  assert.deepEqual(
    filterChannels(channels, "", "all", "all").map((c) => c.id),
    [1, 2, 3, 4]
  );
  assert.deepEqual(filterChannels(channels, "", "all").map((c) => c.id), [1, 2, 3, 4]);
});

test("filterChannels: a query and a platform narrow together, not one or the other", () => {
  // "e" matches rows on both platforms; the platform filter must still apply.
  assert.deepEqual(
    filterChannels(channels, "e", "all", "instagram").map((c) => c.id),
    [4]
  );
});

test("filterChannels: platform and folder narrow together", () => {
  assert.deepEqual(
    filterChannels(channels, "", 10, "youtube").map((c) => c.id),
    [1]
  );
});

test("platformBadge marks the two platforms and shrugs at anything else", () => {
  assert.equal(platformBadge("youtube"), "▶");
  assert.equal(platformBadge("instagram"), "📷");
  assert.equal(platformBadge(undefined), "");
});
```

Add `platformBadge` to the import block at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/parse.test.js`
Expected: FAIL — `does not provide an export named 'platformBadge'`

- [ ] **Step 3: Update `filterChannels` and add `platformBadge`**

In `src/lib/parse.js`, replace `filterChannels`:

```js
/**
 * Popup and dashboard search. Typing searches every folder; an empty query falls
 * back to the folder filter. The platform filter applies either way — otherwise
 * typing would surface rows from the platform you just filtered out.
 * folderId of "all" means no folder filter, null means the Unsorted pile.
 * platform of "all" means no platform filter.
 */
export function filterChannels(channels, query, folderId, platform = "all") {
  const rows =
    platform === "all" ? channels : channels.filter((c) => c.platform === platform);

  const q = (query || "").trim().toLowerCase();
  if (q) {
    return rows.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.handle || "").toLowerCase().includes(q)
    );
  }
  if (folderId === "all") return rows;
  return rows.filter((c) => (c.folder_id ?? null) === folderId);
}

/** The glyph shown on a row to say where it came from. */
export function platformBadge(platform) {
  if (platform === "youtube") return "▶";
  if (platform === "instagram") return "📷";
  return "";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parse.js tests/parse.test.js
git commit -m "feat: filter channels by platform"
```

---

### Task 6: Popup platform filter, badges and avatar fallback

**Files:**
- Create: `src/lib/avatar.js`
- Modify: `src/popup/popup.html:27-29`
- Modify: `src/popup/popup.css`
- Modify: `src/popup/popup.js`

**Interfaces:**
- Consumes: `filterChannels(…, platform)`, `platformBadge` from Task 5; `accountUrl` from Task 1
- Produces: `avatar.wireAvatars(root) -> void` — Task 7 uses the same function

- [ ] **Step 1: Create `src/lib/avatar.js`**

Extension pages forbid inline `onerror` handlers under MV3's CSP, so the fallback is wired up in JS after each render.

```js
// Avatar URLs from both sites are signed CDN links that expire — Instagram's
// within days, YouTube's more slowly. A saved one will eventually 404, so swap
// the broken image for a letter tile rather than showing a blank hole.
//
// Extension pages forbid inline onerror handlers under MV3's CSP, so this has to
// be wired up after the markup lands in the DOM.

export function wireAvatars(root) {
  for (const img of root.querySelectorAll("img.avatar[data-letter]")) {
    if (!img.getAttribute("src")) {
      swap(img);
      continue;
    }
    img.addEventListener("error", () => swap(img), { once: true });
  }
}

function swap(img) {
  const tile = document.createElement("div");
  tile.className = "avatar tile";
  tile.textContent = img.dataset.letter || "?";
  // The save card looks its avatar up by id. Losing it here would make the next
  // lookup return null and take the whole save card down with it.
  if (img.id) tile.id = img.id;
  img.replaceWith(tile);
}

/** First character of a title, for the tile. */
export const initial = (title) => String(title || "?").trim().charAt(0).toUpperCase();
```

- [ ] **Step 2: Add the segmented control to `src/popup/popup.html`**

Replace lines 27-29:

```html
    <div class="pad searchrow">
      <div id="platforms" class="seg">
        <button type="button" class="seg-btn on" data-platform="all">All</button>
        <button type="button" class="seg-btn" data-platform="youtube" title="YouTube">▶</button>
        <button type="button" class="seg-btn" data-platform="instagram" title="Instagram">📷</button>
      </div>
      <input id="search" placeholder="Search…" autocomplete="off">
    </div>
```

- [ ] **Step 3: Style it in `src/popup/popup.css`**

Append to the end of the file:

```css
/* platform filter */
.searchrow { display: flex; align-items: center; gap: 8px; }
.searchrow #search { flex: 1; min-width: 0; }

.seg {
  display: flex;
  flex: none;
  border: 1px solid #33373f;
  border-radius: 6px;
  overflow: hidden;
}
.seg-btn {
  background: #23262c;
  color: #9aa0a8;
  border: 0;
  padding: 9px 9px;
  line-height: 1;
  cursor: pointer;
}
.seg-btn + .seg-btn { border-left: 1px solid #33373f; }
.seg-btn:hover { color: #e6e6e6; }
.seg-btn.on { background: #3b5bdb; color: #fff; }

/* row badge */
.row .badge { flex: none; font-size: 11px; opacity: .75; }

/* avatar fallback for expired CDN links */
.avatar.tile {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #3b5bdb;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
```

- [ ] **Step 4: Wire it up in `src/popup/popup.js`**

Line 3 — extend the imports:

```js
import { filterChannels, folderName, accountUrl, platformBadge } from "../lib/parse.js";
import { wireAvatars, initial } from "../lib/avatar.js";
```

Line 7 — add the platform to state:

```js
let state = { folders: [], channels: [], activeFolder: "all", platform: "all", cursor: 0 };
```

`visibleChannels` (lines 156-158):

```js
function visibleChannels() {
  return filterChannels(state.channels, $("search").value, state.activeFolder, state.platform);
}
```

In `render()`, the folder counts must respect the active platform. Replace the `counts` line and the `chips` array (lines 161-167):

```js
  const inPlatform =
    state.platform === "all"
      ? state.channels
      : state.channels.filter((c) => c.platform === state.platform);

  const counts = (id) => inPlatform.filter((c) => (c.folder_id ?? null) === id).length;

  const chips = [
    { id: "all", name: "All", n: inPlatform.length },
    ...state.folders.map((f) => ({ id: f.id, name: `📁 ${f.name}`, n: counts(f.id) })),
    { id: null, name: "📁 Unsorted", n: counts(null) },
  ];
```

Still in `render()`, replace the row template (lines 189-200) to add the badge and the avatar letter:

```js
  $("list").innerHTML = rows.length
    ? rows
        .map(
          (c, i) => `
      <div class="row ${i === state.cursor ? "sel" : ""}" data-i="${i}">
        <img class="avatar" src="${escapeHtml(c.avatar_url || "")}" data-letter="${escapeHtml(initial(c.title))}" alt="">
        <div class="name">${escapeHtml(c.title)}</div>
        <span class="badge">${platformBadge(c.platform)}</span>
        <div class="tag">${escapeHtml(folderName(state.folders, c.folder_id))}</div>
      </div>`
        )
        .join("")
    : `<div class="empty">${state.channels.length ? "No matches" : "Nothing saved yet — hit ➕ Inspo on a channel"}</div>`;

  wireAvatars($("list"));
```

Then repaint the segmented control's active state. Add this immediately before the final `if (pageChannel) renderSaveState();` line of `render()`:

```js
  for (const b of $("platforms").children) {
    b.classList.toggle("on", b.dataset.platform === state.platform);
  }
```

Finally, add the click handler next to the other listeners, just below the `$("search")` input handler (line 227):

```js
$("platforms").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  state.platform = btn.dataset.platform;
  state.cursor = 0;
  render();
});
```

- [ ] **Step 5: Give the Save card's avatar the same fallback**

In `detectPageChannel` (lines 91-93), replace the avatar line:

```js
  $("save-avatar").src = pageChannel.avatarUrl || "";
  $("save-avatar").dataset.letter = initial(pageChannel.title);
  wireAvatars($("save-card"));
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS. Nothing here is unit-testable; this confirms Task 5 still holds.

- [ ] **Step 7: Reload and check the popup**

- The `All ▶ 📷` control sits left of the search box, `All` highlighted
- Clicking `▶` shows only YouTube rows; `📷` only Instagram; `All` everything
- Folder chip counts change with the platform — filtering to Instagram shows how many Instagram accounts are in each folder
- Type a query that matches rows on both platforms while filtered to one; only that platform's rows appear
- Every row has a `▶` or `📷` badge
- Arrow keys and Enter still move through and open the filtered list
- An Instagram account saved days ago shows a letter tile instead of a broken image

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: platform filter, badges and avatar fallback in the popup"
```

---

### Task 7: Dashboard platform filter, badges and avatar fallback

**Files:**
- Modify: `src/dashboard/dashboard.html:5`, `:20-26`
- Modify: `src/dashboard/dashboard.css`
- Modify: `src/dashboard/dashboard.js`

**Interfaces:**
- Consumes: `wireAvatars`, `initial` from Task 6; `filterChannels(…, platform)`, `platformBadge` from Task 5
- Produces: nothing downstream

- [ ] **Step 1: Add the control to `src/dashboard/dashboard.html`**

Line 5 — the title still says YT:

```html
  <title>Inspo — Dashboard</title>
```

Then insert the segmented control after the search input (line 23):

```html
      <input id="search" placeholder="Search all channels…" autocomplete="off">
      <div id="platforms" class="seg">
        <button type="button" class="seg-btn on" data-platform="all">All</button>
        <button type="button" class="seg-btn" data-platform="youtube" title="YouTube">▶</button>
        <button type="button" class="seg-btn" data-platform="instagram" title="Instagram">📷</button>
      </div>
```

- [ ] **Step 2: Style it in `src/dashboard/dashboard.css`**

Append to the end of the file:

```css
/* platform filter */
.seg {
  display: flex;
  flex: none;
  border: 1px solid #33373f;
  border-radius: 6px;
  overflow: hidden;
}
.seg-btn {
  background: #23262c;
  color: #9aa0a8;
  border: 0;
  padding: 8px 10px;
  line-height: 1;
  cursor: pointer;
  font: inherit;
}
.seg-btn + .seg-btn { border-left: 1px solid #33373f; }
.seg-btn:hover { color: #e6e6e6; }
.seg-btn.on { background: #3b5bdb; color: #fff; }

/* row badge */
.drow .badge { flex: none; font-size: 12px; opacity: .75; }

/* avatar fallback for expired CDN links */
.avatar.tile {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #3b5bdb;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
```

- [ ] **Step 3: Wire it up in `src/dashboard/dashboard.js`**

Line 3 — extend the imports:

```js
import { filterChannels, folderName, accountUrl, platformBadge } from "../lib/parse.js";
import { wireAvatars, initial } from "../lib/avatar.js";
```

Line 7 — add the platform to state:

```js
let state = { folders: [], channels: [], activeFolder: null, platform: "all" }; // starts on Unsorted
```

In `renderFolders()`, make the counts respect the platform. Replace line 96:

```js
  const inPlatform =
    state.platform === "all"
      ? state.channels
      : state.channels.filter((c) => c.platform === state.platform);
  const counts = (id) => inPlatform.filter((c) => (c.folder_id ?? null) === id).length;
```

In `renderRows()`, replace lines 183-202:

```js
  const q = $("search").value;
  const rows = filterChannels(state.channels, q, state.activeFolder, state.platform);

  $("title").textContent = q
    ? `${rows.length} match${rows.length === 1 ? "" : "es"} across all folders`
    : `${folderName(state.folders, state.activeFolder)} — ${rows.length} channel${rows.length === 1 ? "" : "s"}`;

  $("rows").innerHTML = rows.length
    ? rows
        .map(
          (c) => `
      <div class="drow">
        <input type="checkbox" data-id="${c.id}" ${checked.has(c.id) ? "checked" : ""}>
        <img class="avatar" src="${escapeHtml(c.avatar_url || "")}" data-letter="${escapeHtml(initial(c.title))}" alt="">
        <span class="badge">${platformBadge(c.platform)}</span>
        <a href="${escapeHtml(accountUrl(c))}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>
        <span class="tag">${escapeHtml(folderName(state.folders, c.folder_id))}</span>
      </div>`
        )
        .join("")
    : `<div class="empty">Nothing here</div>`;

  wireAvatars($("rows"));
```

Add the segmented control's repaint at the end of `render()` (line 89-93):

```js
function render() {
  renderFolders();
  renderRows();
  renderBulk();
  for (const b of $("platforms").children) {
    b.classList.toggle("on", b.dataset.platform === state.platform);
  }
}
```

And the click handler, next to the `$("search")` listener (line 239):

```js
$("platforms").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  state.platform = btn.dataset.platform;
  checked.clear();
  render();
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Reload and check the dashboard**

- The `All ▶ 📷` control sits beside the search box
- Filtering to one platform narrows the rows and the sidebar counts
- Every row shows a `▶` or `📷` badge
- Selecting rows and bulk-moving still works while filtered
- Deleting a folder still leaves its channels — of both platforms — in Unsorted
- A broken avatar shows a letter tile

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: platform filter, badges and avatar fallback in the dashboard"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_NOTES.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Update `README.md`**

Replace the title and intro (lines 1-8):

```markdown
# Inspo

Catalog the YouTube channels and Instagram accounts you raid for editing ideas,
so they stop drowning in your subscriptions.

- **One click to save** — a `➕ Inspo` button sits next to Subscribe on YouTube, and next
  to Follow on Instagram.
- **Two clicks to find** — popup opens instantly, search or click a folder, Enter to open.
- **Folders you control** — create, rename, delete. Shared across both platforms; one
  account lives in exactly one folder.
- **Your data, in Postgres** — Supabase free tier, locked to your account with Row Level Security.
```

In the **Using it** table (lines 61-69), replace the first two rows and add one:

```markdown
| Save the channel you're watching | Click **➕ Inspo** next to Subscribe or Follow |
| File it right away | Pick a folder in the panel that opens under the button |
| See one platform only | Popup or dashboard → the `All ▶ 📷` control |
```

In **How it's built** (lines 78-91), replace the file tree:

```
manifest.json          MV3 config
schema.sql             tables + RLS policies — run once in Supabase
src/
  config.js            your project URL + anon key
  supabase.js          auth session + every network call (plain REST, no SDK)
  store.js             cache-first layer: read cache, refresh behind it, write through
  background.js        service worker; the content script's only way to reach the DB
  content-youtube.js   ) tiny: load the platform adapter, hand it to the shared UI
  content-instagram.js )
  content.css          the injected button, picker and toast
  lib/
    parse.js           pure helpers, no platform knowledge — the tested part
    platforms/         one adapter per site: URL parsing, selectors, page reading
    inspo-ui.js        the button + picker + toast, shared by both sites
    avatar.js          letter-tile fallback for expired avatar URLs
  popup/               fast path: save, search, jump
  dashboard/           organizing: folder CRUD, bulk move, remove
tests/                 node --test, no dependencies
```

Append to the **Manual checklist** (after line 121):

```markdown
- [ ] Button appears on an Instagram profile, next to Follow
- [ ] Button appears on a reel and saves the author, not the reel
- [ ] Button does not appear on `/explore/`, `/reels/`, `/direct/inbox/`
- [ ] Instagram accounts file into the same folders as YouTube channels
- [ ] The `All ▶ 📷` filter narrows the list and the folder counts together
- [ ] A broken avatar falls back to a letter tile
```

Append to **Known limits** (after line 129):

```markdown
- **Renaming on Instagram makes a duplicate.** Accounts are keyed on their username,
  because Instagram has no stable public id worth scraping. If a creator changes their
  handle, saving them again adds a second row instead of updating the first.
- **Instagram avatars expire.** They're signed CDN links, so a saved one 404s within days
  and the row falls back to a letter tile. The account still opens fine.
- **Instagram's markup has no stable class names.** The button is anchored by matching the
  text `Follow` / `Following` / `Message`, so a non-English UI won't find it. That list is
  `ACTION_WORDS` in `src/lib/platforms/instagram.js`. On a post or reel by someone you
  already follow there is no such control, and the author's name link is used instead.
- **On a post or reel, the page must prove it's the page you're on.** Instagram opens posts
  as a dialog over the profile behind them, so `root()` only accepts a container holding a
  link to the URL's own shortcode. Everything reads from that one container. If it can't be
  proved, no button appears — deliberately, because the alternative is silently saving
  whichever account was on screen a moment ago.
```

- [ ] **Step 2: Update `PROJECT_NOTES.md`**

Add these rows to the **Decisions** table (after line 31):

```markdown
| **Two platforms, one catalog** | YouTube and Instagram share folders — a hook idea is a hook idea regardless of site. Rejected: separate folder sets, which would mean `Hooks` existing twice. |
| **Instagram accounts keyed on username** | No stable public id worth scraping. Cost: a creator renaming themselves produces a duplicate row. Accepted knowingly. |
| **One content-script UI, two adapters** | The button, picker and toast are ~250 lines and none of it is site-specific. Each site supplies `isSaveablePage`, `findAnchor`, `readAccount`, `onNavigate` and nothing else. |
```

Then replace the **Where to change things** table rows that now point at moved files (lines 52-58):

```markdown
| Button label (`➕ Inspo`) | `src/lib/inspo-ui.js` — the `paint(btn, ...)` calls |
| Button colour / panel style | `src/content.css` |
| YouTube selectors and page reading | `src/lib/platforms/youtube.js` |
| Instagram selectors, reserved routes | `src/lib/platforms/instagram.js` |
| Popup size, colours, layout | `src/popup/popup.css` |
| Popup behaviour, keyboard nav | `src/popup/popup.js` |
| Dashboard | `src/dashboard/` |
| Search rules, folder rules | `src/lib/parse.js` — this is the tested part |
| Network calls / auth | `src/supabase.js` |
| Cache behaviour | `src/store.js` |
```

Add to **Gotchas** (after line 81):

```markdown
- **Instagram's DOM has no stable class names.** `findAnchor()` matches button *text*
  instead. If the button stops appearing, that's the first thing to check — and it will
  not work on a non-English Instagram UI.
- **Bumping `CACHE_VERSION` in `src/store.js`** throws away every cached row and forces a
  resync. That is the correct move whenever the row shape changes; the alternative is the
  popup painting fields that no longer exist.
```

Update the **Setup already done** section (line 41) to record the migration:

```markdown
- `schema.sql` run — `folders` and `channels` tables exist, RLS enabled
- Migration to `(platform, platform_id)` run 2026-08-04 — see the comment block at the
  bottom of `schema.sql`
```

- [ ] **Step 3: Run the tests one last time**

Run: `npm test`
Expected: PASS, all files green.

- [ ] **Step 4: Commit**

```bash
git add README.md PROJECT_NOTES.md
git commit -m "docs: Instagram support"
```

---

## Notes for the implementer

**The riskiest task is 2, not 4.** Task 2 moves ~250 lines of working code between files with no test coverage behind it — the tests only cover the pure helpers. Verify YouTube behaves identically before moving on; a regression introduced there will look like an Instagram bug three tasks later.

**Task 4's selectors will need adjusting against the real site.** Instagram's markup is obfuscated and changes often. `findAnchor` and `readAccount` are written defensively, but they are the one part of this plan most likely to need a tweak in front of an actual page. That's expected — treat it as tuning, not as the plan being wrong.
