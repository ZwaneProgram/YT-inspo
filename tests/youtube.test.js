import { test } from "node:test";
import assert from "node:assert/strict";

import {
  channelIdFromUrl,
  handleFromUrl,
  channelIdFromHtml,
  canonicalUrl,
  isSaveablePage,
  identityFromUrl,
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

test("identityFromUrl returns null on /@handle pages, which need the DOM", () => {
  assert.deepEqual(identityFromUrl(`https://www.youtube.com/channel/${ID}`), {
    platformId: ID,
    handle: null,
  });
  assert.equal(identityFromUrl("https://www.youtube.com/@blenderguru"), null);
});
