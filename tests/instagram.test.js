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
