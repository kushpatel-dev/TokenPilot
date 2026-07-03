// ============================================================
//  TokenPilot — Background Service Worker
//  Handles: install defaults, stats aggregation, popup ↔ content messaging,
//  remote models.json fetch + cache (Ship A: dynamic MODEL_DB).
// ============================================================

const DEFAULTS = {
  isEnabled: true,
  totalTokens: 0,
  sessionTokens: 0,
  promptCount: 0,
};

// ── Remote model registry ────────────────────────────────────
const MODEL_CACHE_KEY = "tp_modelDB";
const MODEL_REMOTE_URL = "https://raw.githubusercontent.com/kushpatel-dev/tokenpilot-models/main/models.json";
const MODEL_ALARM = "tp_model_refresh";
const MODEL_TTL_MS = 24 * 60 * 60 * 1000;
const MODEL_MIN_VERSION = 1;

function validateModelDB(json) {
  if (!json || typeof json !== "object") return false;
  if (typeof json.version !== "number" || json.version < MODEL_MIN_VERSION) return false;
  if (!json.models || typeof json.models !== "object") return false;
  for (const v of Object.values(json.models)) {
    if (!v || typeof v.limit !== "number" || typeof v.name !== "string") return false;
  }
  return true;
}

async function refreshModelDB(force = false) {
  try {
    if (!force) {
      const { [MODEL_CACHE_KEY]: cached } = await chrome.storage.local.get(MODEL_CACHE_KEY);
      if (cached && Date.now() - (cached.fetched_at || 0) < MODEL_TTL_MS) return;
    }
    const res = await fetch(MODEL_REMOTE_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!validateModelDB(json)) throw new Error("bad shape");
    await chrome.storage.local.set({
      [MODEL_CACHE_KEY]: { data: json, fetched_at: Date.now() },
    });
    console.log("[TokenPilot] models.json refreshed: v" + json.version + " (" + Object.keys(json.models).length + " models)");
  } catch (e) {
    console.warn("[TokenPilot] models.json refresh failed:", e?.message || e);
  }
}

// ── Install / Update ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.storage.local.get(Object.keys(DEFAULTS), (stored) => {
    const patch = {};
    for (const [key, val] of Object.entries(DEFAULTS)) {
      if (stored[key] === undefined) patch[key] = val;
    }
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });

  chrome.alarms.create(MODEL_ALARM, { periodInMinutes: 60 * 24 });
  refreshModelDB(true);

  if (reason === "install") {
    console.log("[TokenPilot] installed — welcome!");
  } else if (reason === "update") {
    console.log("[TokenPilot] updated.");
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(MODEL_ALARM, { periodInMinutes: 60 * 24 });
  refreshModelDB(false);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MODEL_ALARM) refreshModelDB(false);
});

// ── Message Router ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    switch (request.type) {

      case "PROMPT_SUBMITTED": {
        const tokens = request.tokens || 0;
        chrome.storage.local.get(["totalTokens", "promptCount"], (res) => {
          chrome.storage.local.set({
            totalTokens: (res.totalTokens || 0) + tokens,
            promptCount: (res.promptCount || 0) + 1,
          });
        });
        sendResponse({ ok: true });
        break;
      }

      case "GET_STATS": {
        chrome.storage.local.get(["totalTokens", "promptCount", "isEnabled"], (res) => {
          sendResponse({
            totalTokens: res.totalTokens || 0,
            promptCount: res.promptCount || 0,
            isEnabled:   res.isEnabled !== false,
          });
        });
        return true;
      }

      case "SET_ENABLED": {
        chrome.storage.local.set({ isEnabled: request.value });
        sendResponse({ ok: true });
        break;
      }

      case "REFRESH_MODEL_DB": {
        refreshModelDB(true).then(() => sendResponse({ ok: true }));
        return true;
      }

      case "OPEN_TARGET_TAB": {
        const url = request.url;
        if (typeof url !== "string" || !/^https:\/\//.test(url)) {
          sendResponse({ ok: false, error: "Invalid URL" });
          break;
        }
        chrome.tabs.create({ url, active: true }, (tab) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ ok: true, tabId: tab && tab.id });
          }
        });
        return true;
      }

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  } catch (e) {
    console.error("[TokenPilot] Background error:", e);
    sendResponse({ ok: false, error: e.message });
  }

  return false;
});
