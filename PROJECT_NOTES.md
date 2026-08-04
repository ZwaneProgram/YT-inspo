# PROJECT_NOTES.md

**Read this first.** It's the record of what was decided and why, so nothing gets
re-litigated or accidentally "fixed" back into a worse state.

Built: 2026-08-01. Status: working, in daily use.

---

## The problem this solves

He runs out of ideas while editing. He has a set of channels he always goes back to for
inspiration — but they're buried among all his other YouTube subscriptions, and digging
them out is slow. He also thinks about them in categories: 3D, 2D, hook ideas.

So: catalog those channels, tag them by category, make them findable in seconds.

---

## Decisions — do not re-open these without asking

| Decision | Why |
|---|---|
| **Channels only** | No saved videos, no timestamps, no per-channel notes. He was offered all three and said channels only. |
| **One folder per channel**, not multi-tag | He picked folders over tags explicitly. A channel lives in exactly one place. |
| **Folders are user-created** | Create / rename / delete from the dashboard. The category list is data, never hardcoded. |
| **Deleting a folder never deletes channels** | They fall back to Unsorted (`ON DELETE SET NULL` in the DB, mirrored in cache). |
| **Two ways to save, on purpose** | The injected `➕ Inspo` button (one click) *and* the popup's Save card. YouTube redesigns break injected buttons; the popup keeps working when that happens. |
| **Cache-first reads** | Supabase is the source of truth; `chrome.storage.local` is a read cache so the popup paints in ~0ms instead of waiting on the network. Also means browsing works offline. |
| **Email+password login** | Not an account system — it's what makes the anon key in `config.js` safe. RLS scopes every row to `auth.uid()`. Without a user, that key would be full read/write to the table for anyone holding it. One sign-in, ever. |
| **No npm, no bundler** | MV3 forbids remote scripts, and bundling `supabase-js` would mean a build step on every tweak. Supabase is called over plain REST (~150 lines in `supabase.js`). Edit a file → reload the extension → done. |
| **Two platforms, one catalog** | YouTube and Instagram share folders — a hook idea is a hook idea regardless of site. Rejected: separate folder sets, which would mean `Hooks` existing twice. |
| **Instagram accounts keyed on username** | No stable public id worth scraping. Cost: a creator renaming themselves produces a duplicate row. Accepted knowingly. |
| **One content-script UI, two adapters** | The button, picker and toast are ~300 lines and none of it is site-specific. Each adapter supplies `platform`, `isSaveablePage`, `findAnchor`, `readAccount`, `onNavigate` and nothing else. |

**Explicitly rejected:** saving individual videos, timestamp clips, per-channel notes,
multi-tag channels, importing the full YouTube subscription list via OAuth.

---

## Setup already done (don't redo)

- Supabase project created, free tier
- `schema.sql` run — `folders` and `channels` tables exist, RLS enabled
- Migration to `(platform, platform_id)` run 2026-08-04 — see the comment block at the
  bottom of `schema.sql`
- User created under **Authentication → Users**
- `src/config.js` filled in with the project URL and anon key
- Extension loaded unpacked in **Brave** from this folder

---

## Where to change things

| Want to change | File |
|---|---|
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
| Keyboard shortcut | `brave://extensions/shortcuts` — no code |

**After any edit:** hit reload ↻ on the extension card in `brave://extensions`.
For `content-youtube.js` / `content-instagram.js` / `lib/inspo-ui.js` / `content.css`
changes, also refresh the tab you're testing on.

```bash
npm test    # pure logic only: URL parsing, search filter, folder rules
```

---

## Gotchas

- **The `➕ Inspo` button will eventually vanish on YouTube** after a redesign. The fix is
  the `SUBSCRIBE_SELECTORS` list at the top of `src/lib/platforms/youtube.js`. Not
  something you broke.
- **Free Supabase projects sleep** after roughly a week with no activity. Browsing still
  works from cache; saving errors until you open the Supabase dashboard to wake it.
- **`isConfigured()` in `src/config.js`** used to compare against placeholder text, so
  pasting real credentials over the placeholders inverted it and silently disabled every
  DB call. It now checks the *shape* of the values instead. Don't turn it back into a
  text comparison.
- **Instagram's DOM has no stable class names.** `findAnchor()` in
  `src/lib/platforms/instagram.js` matches button *text* instead — `ACTION_WORDS` is
  `follow`, `following`, `follow back`, `requested`, `message`. If the button stops
  appearing, that's the first thing to check, and it will not work on a non-English
  Instagram UI. On a post or reel by someone you already follow there is no such control
  at all, so `findAnchor()` falls back to the author's name link — that fallback is
  load-bearing for the product's main use case (saving people via their posts), not a
  nice-to-have.
- **On a post or reel, `root()` in `src/lib/platforms/instagram.js` must prove the DOM
  it's reading actually belongs to the current URL before anything reads from it.**
  Instagram flips the URL before it swaps the DOM, and keeps the previous view mounted
  while it does — a post opened over a profile, a second post opened from inside the
  first one's modal, a permalink opened from the feed. In every case the previous page's
  container is still sitting there and will answer consistently and wrongly. `root()`
  only accepts a candidate that holds a link to the URL's own shortcode; `findAnchor()`
  and `readAccount()` both read from that one proven container so they can never
  disagree. If nothing can be proved, `readAccount()` returns `null` and no button
  appears. That silence is deliberate — the alternative is silently saving whichever
  account was on screen a moment ago. Do not "fix" this by adding a `document.body`
  fallback to `root()` — the code comment there notes that's exactly what let the left
  nav's own-avatar and the "Suggested for you" row's Follow buttons into range before.
- **`dashboard.js` keeps two count closures, `counts` and `totalCounts`, on purpose.**
  `counts` follows the platform filter, for the sidebar badge you're looking at.
  `totalCounts` does not — it's what the delete-folder confirmation reads, because
  deleting a folder relocates that folder's channels on *every* platform, not just the
  one you're currently filtered to. Collapsing them into one would understate the
  confirmation.
- **`avatar.js`'s `swap()` carries the broken `<img>`'s `id` across to the replacement
  tile.** The popup's save card looks its avatar up by id after the swap; drop the id and
  that lookup returns null.
- **Bumping `CACHE_VERSION` in `src/store.js`** throws away every cached row and forces a
  resync. That is the correct move whenever the row shape changes; the alternative is the
  popup painting fields that no longer exist.

## Not verified

RLS is configured and anon requests return `[]`, but that's indistinguishable from an
empty table from the outside. To confirm properly: check **Supabase → Table Editor →
`channels`** (bypasses RLS). Rows there + `[]` from an anon request = RLS working.
