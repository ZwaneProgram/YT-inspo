# Instagram support

**Date:** 2026-08-04
**Status:** approved, not yet implemented
**Migration:** already run against the live Supabase project on 2026-08-04

## Problem

The catalog only holds YouTube channels. Editing inspiration also comes from Instagram —
reels especially — and those accounts currently live nowhere. The same folders apply:
a hook idea is a hook idea regardless of which site it came from.

The obstacle is that the schema and the code are YouTube-shaped down to the column names.
`channels.yt_channel_id` is unique per user, and `content.js` reads a `UC…` id off the page.
Adding a second platform means changing the key, not just adding a content script.

## Decisions

Settled during brainstorming; recorded so they don't get re-litigated:

| Decision | Why |
|---|---|
| **One catalog, shared folders** | An Instagram account and a YouTube channel can both sit in `Hooks`. Categories are about the idea, not the site. Rejected: separate folder sets per platform, which would mean `Hooks` existing twice. |
| **Filterable by platform** | Shared folders, plus a `All · ▶ · 📷` control in the popup and dashboard for when you only want one. |
| **Injected button on Instagram too** | Mirrors YouTube: one click to save, with the popup's Save card as the fallback when a redesign breaks the injection. Rejected: popup-only, which is more robust but gives up the one-click save. |
| **Profiles, posts and reels** | Reels are where an editing idea actually gets spotted. Saving the author without clicking through to their profile is the point. |
| **Keyed on lowercase username** | Instagram has no stable public id worth scraping. See *Identity* below. |
| **Rename the column, don't add a table** | `yt_channel_id` → `platform_id` plus a `platform` column. Rejected: a separate `instagram_accounts` table, which leaves `channels` untouched but doubles every read path in `store.js`, the popup and the dashboard. |
| **Extract the shared content-script UI** | The picker, toast and button lifecycle are ~250 of `content.js`'s ~370 lines and none of it is YouTube-specific. Duplicating it for Instagram would guarantee the two copies drift. |

Unchanged from `PROJECT_NOTES.md`: one folder per account, folders are user-created,
deleting a folder never deletes its contents, two ways to save, cache-first reads,
no npm and no build step.

## Identity

A saved Instagram account is keyed on its **lowercase username**.

Instagram does expose a numeric user id inside the page's embedded JSON, but it moves
between releases and scraping it is the kind of thing that breaks silently. The username
is in the URL, so it is free and obvious.

The cost: if a creator renames themselves, re-saving them creates a second row instead of
updating the first. Accepted, and listed under *Known limits* in the README.

| Field | YouTube | Instagram |
|---|---|---|
| `platform` | `youtube` | `instagram` |
| `platform_id` | `UCabc…` (unchanged) | `blenderguru` — lowercased |
| `handle` | `@blenderguru` | `@blenderguru` — lowercased, so both fields agree |
| `title` | channel name | display name, falling back to the username |
| `url` | `https://www.youtube.com/@blenderguru` | `https://www.instagram.com/blenderguru/` |

`handle` keeps the `@` prefix on both so `filterChannels` matches it without a special case.

## Schema

Run once in the Supabase SQL editor. **This has already been run** against the live project;
it is recorded here so `schema.sql` and the deployed database don't drift.

```sql
alter table channels rename column yt_channel_id to platform_id;
alter table channels add column platform text not null default 'youtube';

alter table channels drop constraint channels_user_id_yt_channel_id_key;
alter table channels add constraint channels_user_platform_id_key
  unique (user_id, platform, platform_id);
alter table channels add constraint channels_platform_check
  check (platform in ('youtube', 'instagram'));

create index if not exists channels_platform_idx on channels (user_id, platform);
```

Existing rows backfill to `youtube` from the column default. Nothing is deleted. The SQL
editor runs the batch in a transaction, so a failure on any statement rolls back all of them.

`schema.sql` is updated to describe the post-migration state for a fresh install, with the
migration block kept beneath it as a comment for anyone rebuilding an older database.

### Ordering

The migration and the code change are not independently deployable. Once the column is
renamed, the old code's `select=…,yt_channel_id,…` returns a 400. So:

1. Run the SQL.
2. Reload the extension in `brave://extensions`.

Between those two steps the extension is broken. That is expected and it is seconds long.

### Cache invalidation

`chrome.storage.local` holds a full copy of the catalog with the old column name. After the
migration those cached rows have an `undefined` `platform_id`, and a cache-first read would
paint them before the network correction arrives.

`store.js` gains a `CACHE_VERSION` constant written into the cached object. `readCache()`
returns `EMPTY` when the stored version doesn't match, which forces `load()` to show an
empty list for the few hundred milliseconds until `sync()` returns. Bumping the constant
is the mechanism for any future shape change too.

## Architecture

```
src/lib/
  parse.js                platform-agnostic only
  platforms/youtube.js    parsing + selectors moved out of content.js
  platforms/instagram.js  same exports, different innards
  inspo-ui.js             button + picker + toast, driven by a platform adapter
src/
  content-youtube.js      import the adapter, hand it to inspo-ui
  content-instagram.js    same
```

`parse.js` keeps `filterChannels`, `folderName`, `orphanChannels`, `folderNameTaken` and
`friendlyWriteError`. The YouTube URL helpers (`channelIdFromUrl`, `handleFromUrl`,
`channelIdFromHtml`, `canonicalUrl`, `isSaveablePage`) move to `platforms/youtube.js`.

### The platform adapter

Every platform module exports the same five things:

| Export | Kind | Contract |
|---|---|---|
| `platform` | string | `"youtube"` or `"instagram"` — stored in the row |
| `isSaveablePage(url)` | pure | Is this a page where saving makes sense? |
| `identityFromUrl(url)` | pure | `{ platformId, handle }` or `null` when the URL alone isn't enough |
| `findAnchor()` | DOM | The element to insert the button after, or `null` |
| `readAccount()` | DOM | The full row shape, or `null` if the page can't be read |
| `onNavigate(cb)` | DOM | Fire `cb` after an SPA navigation |

The first two are pure and therefore tested. The rest touch the DOM and stay on the manual
checklist — the project's existing rule, on the grounds that mocking either site's markup
would only test the mock.

`inspo-ui.js` exports one function, `start(adapter)`. It owns `attach`, `retryAttach`, the
`MutationObserver`, the picker and the toast, and it knows nothing about either site.

### SPA navigation

The two sites differ enough to be worth naming. YouTube fires `yt-navigate-finish`, which
`content.js` already listens for. Instagram fires nothing useful, so its `onNavigate`
compares `location.href` against the last-seen value on the `MutationObserver` tick that
`inspo-ui.js` already runs. Chosen over patching `history.pushState`, which is more precise
but rewrites a global on a page we don't own.

### Reading an Instagram account

**Profile — `/<username>/`.** Username comes off the URL path, rejected when it matches a
reserved top-level route:

```
explore  reels  direct  accounts  p  reel  stories  tv  s  challenge
legal  about  developer  api  settings  your_activity
```

This list is the Instagram equivalent of `SUBSCRIBE_SELECTORS` — the first thing to check
when the button starts appearing where it shouldn't, or stops appearing where it should.

**Post — `/p/<code>/`** and **reel — `/reel/<code>/`.** The username is not in the URL, so
it comes from the author link in the post header. `identityFromUrl` returns `null` for these
and the caller falls back to `readAccount()`, exactly as YouTube's `/@handle` pages already do.

Title is the display name from the profile header, falling back to the username. Avatar is
the profile image in the header, falling back to `og:image`.

### Message protocol

Two existing messages change shape; no new ones:

- `status { platform, platformId }` → unchanged reply (was `{ ytChannelId }`)
- `save { account }` → unchanged reply (was `{ channel }`)
- `listFolders`, `createFolder`, `moveChannel`, `openDashboard` — untouched

`store.lookup(platform, platformId)` matches on both fields. `db.upsertChannel` posts to
`?on_conflict=user_id,platform,platform_id`.

### Manifest

Adds `https://www.instagram.com/*` to `host_permissions`, a second `content_scripts` entry
matching it, and Instagram to the `web_accessible_resources` match list so the content script
can import from `src/lib/`.

Display name changes from `YT Inspo` to `Inspo`. The repo folder stays `yt-inspo` — renaming
it would mean re-adding the unpacked extension in Brave for no benefit.

## UI

### Popup

A segmented control sits in the search row:

```
[ All ][ ▶ ][ 📷 ]     [ search…                    ]
```

`filterChannels(channels, query, folderId, platform)` gains a fourth argument. The platform
filter applies **always**, including while searching — otherwise typing would surface rows
from the platform you just filtered out. Folder chip counts recompute within the active
platform, so filtering to Instagram shows how many Instagram accounts are in each folder.

Each row gets a small `▶` or `📷` badge beside the avatar.

The filter resets to `All` every time the popup opens. Persisting it is out of scope.

### Dashboard

The same badge and the same segmented control. Bulk-move is where a mixed Unsorted pile
actually gets untangled, so filtering matters more here than in the popup.

### Avatars

Instagram avatar URLs are signed CDN links that expire within days, so a stored one will
eventually 404. Both surfaces get an `onerror` handler that swaps the broken image for a
letter tile — the account's first initial on a flat background. YouTube avatars rot the
same way, just more slowly, so this fixes both.

## Error handling

Unchanged in shape from the folder picker: errors render inside the panel and nothing closes
on failure.

Two Instagram-specific cases:

- **The page can't be read** — `readAccount()` returns `null`, so `attach()` returns early
  and no button appears. Identical to YouTube's behaviour when the header hasn't rendered.
- **The username is a reserved route** — `isSaveablePage()` is false, so nothing attaches.

The new `platform` check constraint is not user-reachable: the only two values the code can
send are the two the constraint allows. No new `friendlyWriteError` case.

## Testing

**Pure logic** — `node --test`, no dependencies, as today.

`tests/instagram.test.js` — new:

- Username extracted from `/blenderguru`, `/blenderguru/`, `/blenderguru/?hl=en`, `/blenderguru/tagged/`
- `/BlenderGuru` and `/blenderguru` produce the same `platform_id` and the same `handle`
- Every reserved route rejected by `isSaveablePage`
- `/p/<code>/` and `/reel/<code>/` are saveable but return `null` from `identityFromUrl`
- Non-Instagram hosts rejected
- Canonical URL shape

`tests/youtube.test.js` — the existing URL-parsing cases, moved as-is from
`tests/parse.test.js` to follow their code.

`tests/parse.test.js` — keeps the folder and search cases, plus new ones for the platform
argument to `filterChannels`: filtering to one platform, `all` meaning no filter, and a
query plus a platform filter narrowing together rather than the query winning.

**Manual checklist** — added to the README's existing list:

- [ ] Button appears on an Instagram profile
- [ ] Button appears on a reel and saves the author, not the reel
- [ ] Button appears on a post
- [ ] Button survives navigating profile → reel → profile without a reload
- [ ] Button does *not* appear on `/explore/`, `/reels/`, `/direct/inbox/`
- [ ] Saving an Instagram account files it into the same folder list as YouTube
- [ ] Popup platform filter narrows both the list and the folder counts
- [ ] Search plus a platform filter narrows together
- [ ] A YouTube channel saved before the migration still opens correctly
- [ ] A broken avatar URL falls back to a letter tile

## Out of scope

- Saving individual posts or reels as items. Channels-only is a settled decision from
  `PROJECT_NOTES.md`; this extends what counts as an account, not what counts as a thing.
- Stories and highlights.
- Importing your Instagram following list.
- Persisting the platform filter between popup opens.
- TikTok, X, or any third platform. The adapter shape makes one cheap to add later, but
  adding it now would be designing for a requirement that doesn't exist.
- Backfilling `platform` on rows created by a different machine mid-migration. Single user,
  single machine.
