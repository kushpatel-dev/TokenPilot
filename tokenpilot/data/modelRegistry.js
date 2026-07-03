// ============================================================
//  TokenPilot — Model Registry (dynamic)
//  Loads cached remote models.json (fetched by background.js)
//  and merges over the bundled MODEL_DB from data/models.js.
//  Exposes globals: window.TP_REGISTRY = { get, refresh, onUpdate }
//  Bundled fallbacks remain available as MODEL_DB / DEFAULT_LIMIT.
// ============================================================
(function () {
  "use strict";

  const CACHE_KEY    = "tp_modelDB";
  const REMOTE_URL   = "https://raw.githubusercontent.com/kushpatel-dev/tokenpilot-models/main/models.json";
  const TTL_MS       = 24 * 60 * 60 * 1000;
  const MIN_VERSION  = 1;

  // Snapshot of the bundled defaults (data/models.js already loaded)
  const BUNDLED_MODELS = (typeof MODEL_DB !== "undefined") ? MODEL_DB : {};
  const BUNDLED_LIMIT  = (typeof DEFAULT_LIMIT !== "undefined") ? DEFAULT_LIMIT : 128000;

  let activeModels   = { ...BUNDLED_MODELS };
  let activeLimit    = BUNDLED_LIMIT;
  let activeMeta     = { source: "bundled", updated_at: null, version: 0 };
  const subscribers  = new Set();

  function notify() {
    subscribers.forEach((fn) => { try { fn(activeModels, activeLimit, activeMeta); } catch (_) {} });
  }

  function validShape(json) {
    if (!json || typeof json !== "object") return false;
    if (typeof json.version !== "number" || json.version < MIN_VERSION) return false;
    if (!json.models || typeof json.models !== "object") return false;
    for (const v of Object.values(json.models)) {
      if (!v || typeof v.limit !== "number" || typeof v.name !== "string") return false;
    }
    return true;
  }

  function apply(json, source) {
    activeModels = { ...BUNDLED_MODELS, ...json.models };
    activeLimit  = typeof json.default_limit === "number" ? json.default_limit : BUNDLED_LIMIT;
    activeMeta   = { source, updated_at: json.updated_at || null, version: json.version };
    notify();
  }

  function loadFromCache() {
    try {
      if (!chrome?.storage?.local) return Promise.resolve(false);
      return new Promise((resolve) => {
        chrome.storage.local.get(CACHE_KEY, (res) => {
          const cached = res?.[CACHE_KEY];
          if (cached && cached.data && validShape(cached.data)) {
            apply(cached.data, "cache");
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });
    } catch (_) { return Promise.resolve(false); }
  }

  async function fetchRemote() {
    try {
      const res = await fetch(REMOTE_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (!validShape(json)) throw new Error("bad shape");
      try {
        chrome.storage.local.set({ [CACHE_KEY]: { data: json, fetched_at: Date.now() } });
      } catch (_) {}
      apply(json, "remote");
      return true;
    } catch (e) {
      console.warn("[TokenPilot] remote models.json fetch failed:", e?.message || e);
      return false;
    }
  }

  // Storage change listener — when background.js refreshes cache, content scripts pick it up.
  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !changes[CACHE_KEY]) return;
      const next = changes[CACHE_KEY].newValue;
      if (next?.data && validShape(next.data)) apply(next.data, "cache-sync");
    });
  } catch (_) {}

  // Initial load — read cache once. Background handles network fetch.
  loadFromCache();

  window.TP_REGISTRY = {
    get models() { return activeModels; },
    get defaultLimit() { return activeLimit; },
    get meta() { return activeMeta; },
    refresh: fetchRemote,
    onUpdate(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  };
})();
