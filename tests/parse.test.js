import { test } from "node:test";
import assert from "node:assert/strict";

import {
  channelIdFromUrl,
  handleFromUrl,
  channelIdFromHtml,
  canonicalUrl,
  isSaveablePage,
  filterChannels,
  folderName,
  orphanChannels,
} from "../src/lib/parse.js";

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
    canonicalUrl({ handle: "@blenderguru", ytChannelId: ID }),
    "https://www.youtube.com/@blenderguru"
  );
  assert.equal(
    canonicalUrl({ handle: null, ytChannelId: ID }),
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

// ---------------------------------------------------------------------------

const channels = [
  { id: 1, title: "Blender Guru", handle: "@blenderguru", folder_id: 10 },
  { id: 2, title: "Alan Becker", handle: "@alanbecker", folder_id: 20 },
  { id: 3, title: "Some Guy", handle: "@someguy", folder_id: null },
];
const folders = [
  { id: 10, name: "3D" },
  { id: 20, name: "2D" },
];

test("filterChannels: a query searches every folder, not just the active one", () => {
  const hits = filterChannels(channels, "alan", 10);
  assert.deepEqual(hits.map((c) => c.id), [2]);
});

test("filterChannels: matches on handle too", () => {
  assert.deepEqual(filterChannels(channels, "someguy", "all").map((c) => c.id), [3]);
});

test("filterChannels: empty query falls back to the folder filter", () => {
  assert.deepEqual(filterChannels(channels, "", 10).map((c) => c.id), [1]);
  assert.deepEqual(filterChannels(channels, "   ", "all").map((c) => c.id), [1, 2, 3]);
});

test("filterChannels: null folder is the Unsorted pile", () => {
  assert.deepEqual(filterChannels(channels, "", null).map((c) => c.id), [3]);
});

test("folderName falls back to Unsorted for null and unknown ids", () => {
  assert.equal(folderName(folders, 10), "3D");
  assert.equal(folderName(folders, null), "Unsorted");
  assert.equal(folderName(folders, 999), "Unsorted");
});

test("orphanChannels moves a deleted folder's channels to Unsorted, keeping them", () => {
  const after = orphanChannels(channels, 10);
  assert.equal(after.length, 3, "no channel is lost when a folder is deleted");
  assert.equal(after.find((c) => c.id === 1).folder_id, null);
  assert.equal(after.find((c) => c.id === 2).folder_id, 20, "other folders untouched");
});
