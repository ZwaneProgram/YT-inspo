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

test("folderNameTaken ignores case and surrounding space", () => {
  assert.equal(folderNameTaken(folders, "3D"), true);
  assert.equal(folderNameTaken(folders, "3d"), true);
  assert.equal(folderNameTaken(folders, "  3D  "), true);
  assert.equal(folderNameTaken(folders, "Hooks"), false);
  assert.equal(folderNameTaken([], "anything"), false);
});

test("folderNameTaken treats an empty name as free", () => {
  assert.equal(folderNameTaken(folders, "   "), false);
  assert.equal(folderNameTaken(folders, ""), false);
});

test("friendlyWriteError explains a duplicate folder name", () => {
  const body =
    '{"code":"23505","message":"duplicate key value violates unique constraint ' +
    '\\"folders_user_id_name_key\\""}';
  assert.equal(friendlyWriteError(body), "You already have a folder with that name");
});

test("friendlyWriteError leaves other messages alone", () => {
  assert.equal(friendlyWriteError("Not signed in"), "Not signed in");
  assert.equal(friendlyWriteError(""), "Something went wrong");
  assert.equal(friendlyWriteError(null), "Something went wrong");
});

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
