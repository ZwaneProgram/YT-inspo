# Inspo folder picker

**Date:** 2026-08-01
**Status:** approved, not yet implemented

## Problem

Clicking `➕ Inspo` saves the channel to Unsorted and shows a toast with a `<select>`
of existing folders. Three things are wrong with it:

1. The toast disappears after 4 seconds, so the decision is on a timer.
2. You cannot create a folder from it — new categories mean a trip to the dashboard.
3. On an already-saved channel it shows `Already saved — in 3D` and nothing else, so
   re-filing a mis-filed channel also means a trip to the dashboard.

## Decisions

Settled during brainstorming; recorded so they don't get re-litigated:

| Decision | Why |
|---|---|
| **Save first, then pick** | One click still saves. The channel lands in Unsorted immediately and the picker moves it. Dismissing the picker never loses the save. |
| **Clicking a saved channel opens the picker too** | Makes the button one consistent thing: click it, choose where this channel goes. Replaces the `Already saved` flash. |
| **Panel anchored under the button** | Shortest mouse travel — your eye is already at the button you just clicked. Chosen over a bottom-right toast and a centered modal. |
| **No auto-dismiss** | A picker that vanishes mid-decision is the bug being fixed. |
| **Plain DOM, not an iframe** | Matches how `content.css` already scopes the button. An iframe would give perfect CSS isolation but needs `web_accessible_resources` plus a message bridge for what is a small dropdown. |

Unchanged from `PROJECT_NOTES.md`: one folder per channel, folders are user-created,
deleting a folder never deletes channels, two ways to save.

## Behaviour

### Opening

- `➕ Inspo` on an unsaved channel: save to Unsorted (existing `save` message), then open
  the panel with `Unsorted` ticked.
- `➕ Inspo` on a saved channel: no write, open the panel with its current folder ticked.
- Not signed in: unchanged — opens the dashboard, no panel.
- Save failed: unchanged — error toast, no panel.
- Clicking `➕ Inspo` while the panel is open closes it (toggle).

### Contents

```
📁 3D
📁 2D            ✓
📁 Hook ideas
📁 Unsorted
─────────────────
+ New folder…
```

- Folders in the order `listFolders` returns them (`position asc, name asc`), then
  `Unsorted` last. Same order as the dashboard sidebar.
- A `✓` marks the channel's current folder.
- With no folders yet, the panel shows only `Unsorted ✓` and `+ New folder…`, and the
  new-folder input opens focused — there is nothing else to click.

### Choosing a folder

- Click a folder → `moveChannel` → button repaints to `✓ <name>` → panel closes.
- Clicking the folder it is already in → panel closes, no request sent.

### Creating a folder

- `+ New folder…` turns that row into a text input.
- Enter → create the folder, then file the channel into it, then close. Two calls:
  `createFolder`, then `moveChannel` with the returned id.
- Escape → row reverts to `+ New folder…`, panel stays open.
- Empty or whitespace-only name → ignored, input stays open.
- Name already taken → inline error, input stays open with the text intact (see below).

### Closing

Click outside the panel, or Escape. On YouTube SPA navigation the panel closes with the
button it is anchored to. No timer.

## Architecture

| File | Change |
|---|---|
| `src/content.js` | Add `openPicker(channel, savedId, currentFolderId)`. Remove the `<select>` block from `toast()`; `toast()` stays for errors only. |
| `src/content.css` | `.yt-inspo-panel` and children. |
| `src/background.js` | Add one handler: `createFolder({ name })` → `store.addFolder(name)` → `{ folder }`. |
| `src/lib/parse.js` | Add `folderNameTaken(folders, name)` — pure, tested. |
| `tests/parse.test.js` | Cases for `folderNameTaken`. |

No manifest changes, no new dependencies, no schema changes.

### Message protocol

Existing messages cover everything but folder creation:

- `listFolders` → `{ folders }` (already exists)
- `moveChannel { id, folderId }` → `{ ok }` (already exists)
- `createFolder { name }` → `{ folder }` — **new**

`listFolders` reads `chrome.storage.local`. The dashboard and popup write through to that
same cache, so a folder made in either is already visible to the panel. Only a change made
on a different machine would be missed, which is out of scope.

### Positioning

`position: fixed`, anchored to `getBoundingClientRect()` of the button, flipped upward when
it would run past the viewport bottom. The watch page and channel page put the button in
different layouts and YouTube's header is sticky, so this is the fiddly part and needs
checking on both page types.

### CSS isolation

Scope every rule under `.yt-inspo-panel` and set explicit values for anything YouTube might
inherit into it: `font`, `color`, `background`, `line-height`, `text-transform`, `box-sizing`,
`margin`, `padding`. Same approach `content.css` already takes with `button#yt-inspo-btn`.

## Error handling

Errors render **inside** the panel and it stays open. Nothing closes on failure.

`folders` has `unique (user_id, name)`, so a duplicate name comes back from PostgREST as a
raw `23505` constraint body — not something to show a person. Two layers:

1. **Before the request:** `folderNameTaken(folders, name)` compares case-insensitively
   against trimmed names and shows `You already have a folder called "3D"`, no round trip.
2. **After the request:** `createFolder` in `background.js` catches the write, and a message
   matching `23505` or `duplicate key` becomes the same friendly text. Backstop for a folder
   created elsewhere since the cache was written.

A failed `moveChannel` leaves the panel open with the error and the tick unmoved.

Creating a folder is two calls, so it can half-succeed. If `createFolder` lands but the
follow-up `moveChannel` fails, the folder is kept — it exists and the user asked for it.
The panel re-renders with the new folder in the list, unticked, and shows the move error.
Clicking it retries the move. The folder is never rolled back.

## Testing

**Pure logic** (`tests/parse.test.js`, `node --test`, no dependencies):
`folderNameTaken` — exact match, differing case, surrounding whitespace, empty folder list,
name that is genuinely free.

**Panel behaviour** — headless Edge over CDP, the harness built for the dashboard bug hunt,
against a stub YouTube header:

- Panel opens on click and lists folders in order with `✓` on the current one
- Clicking a folder sends `moveChannel` and repaints the button
- Clicking the current folder sends nothing
- `+ New folder…` → Enter creates the folder and files the channel into it
- Duplicate name shows the inline error and keeps the typed text
- Escape and outside-click close it; it does **not** close on its own after 4 seconds
- Panel opens on both a watch page and a channel page layout

## Out of scope

- Keyboard navigation within the panel (arrow keys). Mouse-first; Escape is the only key
  besides Enter in the new-folder input.
- Renaming or deleting folders from the panel — that stays in the dashboard.
- Multi-select or multi-tag. One folder per channel is a settled decision.
- Reordering folders.
