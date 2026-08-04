# Inspo

Catalog the YouTube channels and Instagram accounts you raid for editing ideas,
so they stop drowning in your subscriptions.

- **One click to save** — a `➕ Inspo` button sits next to Subscribe on YouTube, and next
  to Follow on Instagram.
- **Two clicks to find** — popup opens instantly, search or click a folder, Enter to open.
- **Folders you control** — create, rename, delete. Shared across both platforms; one
  account lives in exactly one folder.
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
| Save the channel you're watching | Click **➕ Inspo** next to Subscribe or Follow |
| File it right away | Pick a folder in the panel that opens under the button |
| See one platform only | Popup or dashboard → the `All ▶ 📷` control |
| Find a channel fast | `Ctrl+Shift+Y`, start typing, `Enter` |
| Browse a category | `Ctrl+Shift+Y`, click a folder chip |
| Clean up Unsorted | Popup → **⚙ Dashboard** → tick channels → **Move to** |
| Rename a folder | Dashboard → double-click the folder name |
| Delete a folder | Dashboard → hover it → **✕**. Its channels move to Unsorted, they are not deleted. |

**Saving is idempotent.** Hitting ➕ Inspo on an account you already have doesn't duplicate it —
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
  content-youtube.js   ) tiny: load the platform adapter, hand it to the shared UI
  content-instagram.js )
  content.css          the injected button, picker and toast
  lib/
    parse.js           pure helpers, no platform knowledge — the tested part
    platforms/         one adapter per site: URL parsing, selectors, page reading
    inspo-ui.js         the button + picker + toast, shared by both sites
    avatar.js           letter-tile fallback for expired avatar URLs
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

Covers the pure logic — channel-ID and username extraction across YouTube's and
Instagram's URL shapes, the search and platform filters, and the rule that deleting a
folder never deletes its channels. The DOM injection and UI rendering are checked by hand
(see the manual checklist below); mocking YouTube's or Instagram's markup would only test
the mock.

## Manual checklist

- [ ] Button appears on a channel page (`/@handle`)
- [ ] Button appears on a video page
- [ ] Button appears after navigating between videos without a page reload
- [ ] Saving opens the folder picker under the button; picking a folder files it there
- [ ] Clicking an already-saved channel opens the picker straight to its current folder, no duplicate row
- [ ] `Ctrl+Shift+Y` opens the popup with the cursor already in the search box
- [ ] Typing filters across all folders; clicking a folder chip filters to it
- [ ] Deleting a folder in the dashboard leaves its channels in Unsorted
- [ ] Button appears on an Instagram profile, next to Follow
- [ ] Button appears on a reel and saves the author, not the reel
- [ ] Button does not appear on `/explore/`, `/reels/`, `/direct/inbox/`
- [ ] Instagram accounts file into the same folders as YouTube channels
- [ ] The `All ▶ 📷` filter narrows the list and the folder counts together
- [ ] A broken avatar falls back to a letter tile

## Known limits

- **Free Supabase projects sleep** after ~a week of no activity. Browsing still works from
  cache; saving will error until you open your Supabase dashboard to wake it.
- **YouTube redesigns break the injected button.** The selectors are `SUBSCRIBE_SELECTORS` in
  `src/lib/platforms/youtube.js`. The popup's Save card keeps working regardless — that's why
  both exist.
- **Renaming on Instagram makes a duplicate.** Accounts are keyed on their username,
  because Instagram has no stable public id worth scraping. If a creator changes their
  handle, saving them again adds a second row instead of updating the first.
- **Instagram avatars expire.** They're signed CDN links, so a saved one 404s within days
  and the row falls back to a letter tile. The account still opens fine.
- **Instagram's markup has no stable class names.** The button is anchored by matching the
  text `Follow` / `Following` / `Follow back` / `Requested` / `Message` — that list is
  `ACTION_WORDS` in `src/lib/platforms/instagram.js` — so a non-English UI won't find it. On a
  post or reel by someone you already follow there is no such control, and the author's name
  link is used instead — that fallback is load-bearing, not a nice-to-have.
- **On a post or reel, the page must prove it's the page you're on.** Instagram opens posts
  as a dialog over the profile behind them and keeps that previous view mounted while it
  does, so `root()` in `src/lib/platforms/instagram.js` only accepts a container holding a
  link to the URL's own shortcode. Everything reads from that one container. If it can't be
  proved, no button appears — deliberately, because the alternative is silently saving
  whichever account was on screen a moment ago.
