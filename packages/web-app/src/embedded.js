// embedded.js — Datalex-Cloud embed shim.
//
// Activated when the URL contains ?embedded=1. Two responsibilities:
//
//   1. Theme: listen for `datalex.theme` postMessage from the parent
//      frame (Datalex-Cloud) and apply the colour tokens to Luna CSS
//      variables so the DataLex UI matches the host's brand palette.
//
//   2. Storage isolation: namespace localStorage keys with the project
//      id from the query param. Without this, two tenants/projects
//      embedding into the same Datalex-Cloud origin would clobber each
//      other's offline-doc state, theme prefs, panel layout, etc.
//
// This file is imported once from main.jsx; it self-installs only when
// the embed flag is present, so standalone DataLex usage is unaffected.

const params = new URLSearchParams(window.location.search);
const isEmbedded = params.get("embedded") === "1";
const projectId = params.get("project") || "shared";

if (isEmbedded) {
  // 1. localStorage namespace.
  const namespacedKey = (key) => `dlx:${projectId}:${key}`;
  const realStorage = window.localStorage;
  const storageProxy = {
    getItem: (k) => realStorage.getItem(namespacedKey(k)),
    setItem: (k, v) => realStorage.setItem(namespacedKey(k), v),
    removeItem: (k) => realStorage.removeItem(namespacedKey(k)),
    clear: () => {
      const prefix = `dlx:${projectId}:`;
      for (let i = realStorage.length - 1; i >= 0; i--) {
        const k = realStorage.key(i);
        if (k && k.startsWith(prefix)) realStorage.removeItem(k);
      }
    },
    key: (i) => {
      const prefix = `dlx:${projectId}:`;
      const matched = [];
      for (let j = 0; j < realStorage.length; j++) {
        const k = realStorage.key(j);
        if (k && k.startsWith(prefix)) matched.push(k.slice(prefix.length));
      }
      return matched[i] ?? null;
    },
    get length() {
      const prefix = `dlx:${projectId}:`;
      let n = 0;
      for (let i = 0; i < realStorage.length; i++) {
        const k = realStorage.key(i);
        if (k && k.startsWith(prefix)) n++;
      }
      return n;
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: storageProxy,
    configurable: true,
  });

  // 2. Theme bridge — apply tokens posted by the parent.
  window.addEventListener("message", (ev) => {
    if (!ev.data || ev.data.type !== "datalex.theme") return;
    const tokens = ev.data.tokens || {};
    const root = document.documentElement;
    if (tokens.brand) root.style.setProperty("--lux-color-accent", tokens.brand);
    if (tokens.ink900) root.style.setProperty("--lux-color-text", tokens.ink900);
    if (tokens.bg) root.style.setProperty("--lux-color-bg", tokens.bg);
    if (tokens.surface)
      root.style.setProperty("--lux-color-surface", tokens.surface);
    if (tokens.border)
      root.style.setProperty("--lux-color-border", tokens.border);
  });

  // Tell the parent we're ready to receive theme tokens.
  if (window.parent !== window) {
    window.parent.postMessage(
      { type: "datalex.embedded.ready", projectId },
      "*",
    );
  }
}

export { isEmbedded };
