# YT Inspo

Catalog the YouTube channels you raid for editing ideas, so they stop drowning in your subscriptions.

- **One click to save** — a `➕ Inspo` button sits next to Subscribe on any channel or video page.
- **Two clicks to find** — popup opens instantly, search or click a folder, Enter to open the channel.
- **Folders you control** — create, rename, delete. One channel lives in exactly one folder.
- **Your data, in Postgres** — Supabase free tier, locked to your account with Row Level Security.

---

## Setup (about 10 minutes, once)

### 1. Make the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Free plan. Any region near you.
2. Wait for it to finish provisioning (~2 min).

### 2. Create the tables

**SQL Editor** → **New query** → paste the whole of [`schema.sql`](schema.sql) → **Run**.

You should see "Success. No rows returned."

### 3. Make your user account

**Authentication** → **Users** → **Add user** → **Create new user**.

Use an email and password you'll remember — this is what you'll sign into the extension with.

> Tick **Auto Confirm User** so you don't have to click a confirmation email.

### 4. Point the extension at your project

**Project Settings** → **API**, and copy two values into `src/config.js`:

```js
export const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";  // Project URL
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";                 // anon / public key
```

The anon key is safe to sit in this file. RLS means it can only touch rows owned by
whoever is signed in — it is not a master key to your data.

### 5. Load it into Brave

1. Go to `brave://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder (`yt-inspo`)
4. Pin it to the toolbar so `Ctrl+Shift+Y` has somewhere to open

### 6. Sign in

Click the toolbar icon, enter the email and password from step 3. That's it — the session
persists, so you won't do this again.

---

## Using it

| What | How |
|---|---|
| Save the channel you're watching | Click **➕ Inspo** next to Subscribe |
| File it while the toast is up | Pick a folder in the toast (or ignore it — Unsorted is fine) |
| Find a channel fast | `Ctrl+Shift+Y`, start typing, `Enter` |
| Browse a category | `Ctrl+Shift+Y`, click a folder chip |
| Clean up Unsorted | Popup → **⚙ Dashboard** → tick channels → **Move to** |
| Rename a folder | Dashboard → double-click the folder name |
| Delete a folder | Dashboard → hover it → **✕**. Its channels move to Unsorted, they are not deleted. |

**Saving is idempotent.** Hitting ➕ Inspo on a channel you already have doesn't duplicate it —
it just tells you which folder it's in.

---

## How it's built

```
manifest.json          MV3 config
schema.sql             tables + RLS policies — run once in Supabase
src/
  config.js            your project URL + anon key
  supabase.js          auth session + every network call (plain REST, no SDK)
  store.js             cache-first layer: read cache, refresh behind it, write through
  background.js        service worker; the content script's only way to reach the DB
  content.js/.css      the ➕ Inspo button + toast on YouTube
  lib/parse.js         pure helpers (URL parsing, search, folder rules) — the tested part
  popup/               fast path: save, search, jump
  dashboard/           organizing: folder CRUD, bulk move, remove
tests/                 node --test, no dependencies
```

**No npm install, no build step.** It's plain ES modules; Supabase is called over its REST
API directly. Edit a file, hit reload on `brave://extensions`, done.

**Why cache-first:** Supabase is the source of truth, but the popup renders from
`chrome.storage.local` first so it never makes you wait on the network. It refreshes in the
background and re-renders if anything changed. Side benefit: browsing still works when
you're offline or the free project has gone to sleep.

## Tests

```bash
npm test
```

Covers the pure logic — channel-ID extraction across YouTube's URL shapes, the search
filter, and the rule that deleting a folder never deletes its channels. The DOM injection
and UI rendering are checked by hand (see the manual checklist below); mocking YouTube's
markup would only test the mock.

## Manual checklist

- [ ] Button appears on a channel page (`/@handle`)
- [ ] Button appears on a video page
- [ ] Button appears after navigating between videos without a page reload
- [ ] Saving shows the toast; picking a folder in it moves the channel
- [ ] Clicking an already-saved channel says "Already saved — in X", no duplicate row
- [ ] `Ctrl+Shift+Y` opens the popup with the cursor already in the search box
- [ ] Typing filters across all folders; clicking a folder chip filters to it
- [ ] Deleting a folder in the dashboard leaves its channels in Unsorted

## Known limits

- **Free Supabase projects sleep** after ~a week of no activity. Browsing still works from
  cache; saving will error until you open your Supabase dashboard to wake it.
- **YouTube redesigns break the injected button.** The selectors in `content.js`
  (`SUBSCRIBE_SELECTORS`) are the thing to update. The popup's Save card keeps working
  regardless — that's why both exist.
