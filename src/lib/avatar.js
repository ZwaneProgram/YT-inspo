// Avatar URLs from both sites are signed CDN links that expire — Instagram's
// within days, YouTube's more slowly. A saved one will eventually 404, so swap
// the broken image for a letter tile rather than showing a blank hole.
//
// Extension pages forbid inline onerror handlers under MV3's CSP, so this has to
// be wired up after the markup lands in the DOM.

export function wireAvatars(root) {
  for (const img of root.querySelectorAll("img.avatar[data-letter]")) {
    if (!img.getAttribute("src")) {
      swap(img);
      continue;
    }
    img.addEventListener("error", () => swap(img), { once: true });
  }
}

function swap(img) {
  const tile = document.createElement("div");
  tile.className = "avatar tile";
  tile.textContent = img.dataset.letter || "?";
  // The save card looks its avatar up by id. Losing it here would make the next
  // lookup return null and take the whole save card down with it.
  if (img.id) tile.id = img.id;
  img.replaceWith(tile);
}

/** First character of a title, for the tile. */
export const initial = (title) => String(title || "?").trim().charAt(0).toUpperCase();
