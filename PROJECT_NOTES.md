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

**Explicitly rejected:** saving individual videos, timestamp clips, per-channel notes,
multi-tag channels, importing the full YouTube subscription list via OAuth.

---

## Setup already done (don't redo)

- Supabase project created, free tier
- `schema.sql` run — `folders` and `channels` tables exist, RLS enabled
- User created under **Authentication → Users**
- `src/config.js` filled in with the project URL and anon key
- Extension loaded unpacked in **Brave** from this folder

---

## Where to change things

| Want to change | File |
|---|---|
| Button label (`➕ Inspo`) | `src/content.js` — the `paint(btn, ...)` calls |
| Button colour / toast style | `src/content.css` |
| Toast duration | `src/content.js` — `4000` |
| Popup size, colours, layout | `src/popup/popup.css` |
| Popup behaviour, keyboard nav | `src/popup/popup.js` |
| Dashboard | `src/dashboard/` |
| Search rules, folder rules, URL parsing | `src/lib/parse.js` — this is the tested part |
| Network calls / auth | `src/supabase.js` |
| Cache behaviour | `src/store.js` |
| Keyboard shortcut | `brave://extensions/shortcuts` — no code |

**After any edit:** hit reload ↻ on the extension card in `brave://extensions`.
For `content.js` / `content.css` changes, also refresh the YouTube tab.

```bash
npm test    # pure logic only: URL parsing, search filter, folder rules
```

---

## Gotchas

- **The `➕ Inspo` button will eventually vanish** after a YouTube redesign. The fix is
  the `SUBSCRIBE_SELECTORS` list at the top of `src/content.js`. Not something you broke.
- **Free Supabase projects sleep** after roughly a week with no activity. Browsing still
  works from cache; saving errors until you open the Supabase dashboard to wake it.
- **`isConfigured()` in `src/config.js`** used to compare against placeholder text, so
  pasting real credentials over the placeholders inverted it and silently disabled every
  DB call. It now checks the *shape* of the values instead. Don't turn it back into a
  text comparison.

## Not verified

RLS is configured and anon requests return `[]`, but that's indistinguishable from an
empty table from the outside. To confirm properly: check **Supabase → Table Editor →
`channels`** (bypasses RLS). Rows there + `[]` from an anon request = RLS working.
