// Content scripts can't use static imports, so pull the modules in dynamically
// and hand the adapter to the shared UI.

(async () => {
  const [adapter, ui] = await Promise.all([
    import(chrome.runtime.getURL("src/lib/platforms/instagram.js")),
    import(chrome.runtime.getURL("src/lib/inspo-ui.js")),
  ]);
  ui.start(adapter);
})();
