// ============================================================
//  TokenPilot v3.2 — Background Service Worker
//  Handles: install defaults, stats aggregation, popup ↔ content messaging
// ============================================================

const DEFAULTS = {
  isEnabled: true,
  totalTokens: 0,
  sessionTokens: 0,
  promptCount: 0,
};

// ── Install / Update ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.storage.local.get(Object.keys(DEFAULTS), (stored) => {
    const patch = {};
    for (const [key, val] of Object.entries(DEFAULTS)) {
      if (stored[key] === undefined) patch[key] = val;
    }
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });

  if (reason === "install") {
    console.log("[TokenPilot] v3.2 installed — welcome!");
  } else if (reason === "update") {
    console.log("[TokenPilot] v3.2 updated.");
  }
});

// ── Message Router ───────────────────────────────────────────
//  Content script sends messages here to keep heavy storage
//  logic off the main page thread.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    switch (request.type) {

      // Content script reports a prompt was submitted
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

      // Popup requests fresh stats
      case "GET_STATS": {
        chrome.storage.local.get(["totalTokens", "promptCount", "isEnabled"], (res) => {
          sendResponse({
            totalTokens: res.totalTokens || 0,
            promptCount: res.promptCount || 0,
            isEnabled:   res.isEnabled !== false,
          });
        });
        return true; // keep channel open for async sendResponse
      }

      // Popup toggles the extension on/off
      case "SET_ENABLED": {
        chrome.storage.local.set({ isEnabled: request.value });
        sendResponse({ ok: true });
        break;
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
