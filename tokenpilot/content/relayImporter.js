/* TokenPilot — relay importer.
 *
 * Watches the clipboard for markdown tagged with `<!-- TOKENPILOT-RELAY:v1 -->`.
 * When detected on a supported AI host, offers a one-click import that stages
 * the payload for autopaste.js and triggers its run().
 *
 * Source of the payload: a terminal-side companion (bash script, VS Code
 * extension, etc.) that pipes a session transcript through `pbcopy`/`xclip`.
 *
 * Permissions used: clipboardRead.
 */

(function () {
  "use strict";

  if (window.__tokenPilotRelayImporterLoaded) return;
  window.__tokenPilotRelayImporterLoaded = true;

  const LOG_TAG      = "[TokenPilot relay]";
  const RELAY_HEADER = /^<!--\s*TOKENPILOT-RELAY:v(\d+)\s*-->/;
  const DEDUPE_MS    = 60 * 60 * 1000; // ignore same payload for 1h
  const SEEN_KEY     = "__tp_relay_seen_hash";

  function log()  { try { console.log .apply(console, [LOG_TAG].concat([].slice.call(arguments))); } catch (_) {} }
  function warn() { try { console.warn.apply(console, [LOG_TAG].concat([].slice.call(arguments))); } catch (_) {} }

  // Cheap 32-bit rolling hash for dedupe. Not cryptographic — collision fine.
  function hashText(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  function wasRecentlySeen(hash) {
    try {
      const raw = sessionStorage.getItem(SEEN_KEY);
      if (!raw) return false;
      const rec = JSON.parse(raw);
      return rec.hash === hash && Date.now() - rec.ts < DEDUPE_MS;
    } catch (_) { return false; }
  }

  function markSeen(hash) {
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify({ hash, ts: Date.now() })); } catch (_) {}
  }

  // ── Toast with actions ────────────────────────────────────────
  function showImportPrompt(text, onAccept) {
    const id = "__tokenpilot_relay_toast";
    document.getElementById(id)?.remove();

    const host = document.createElement("div");
    host.id = id;
    host.style.cssText = [
      "position:fixed", "z-index:2147483647",
      "right:20px", "bottom:20px",
      "min-width:300px", "max-width:380px",
      "padding:14px 16px",
      "font:500 13px/1.45 'Geist',system-ui,-apple-system,sans-serif",
      "color:#ededf0",
      "background:linear-gradient(135deg,#1a1a22,#232336)",
      "border:1px solid rgba(167,139,250,0.45)",
      "border-radius:12px",
      "box-shadow:0 12px 36px rgba(0,0,0,0.5)"
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "TokenPilot · Import chat from clipboard?";
    title.style.cssText = "font-weight:600;font-size:12.5px;color:#c084fc;margin-bottom:6px;letter-spacing:0.01em;";

    const meta = document.createElement("div");
    const preview = text.replace(/<!--[\s\S]*?-->/g, "").trim().slice(0, 90).replace(/\s+/g, " ");
    meta.textContent = preview + (text.length > 90 ? "…" : "");
    meta.style.cssText = "color:#a1a1aa;font-size:11px;margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    const dismissBtn = document.createElement("button");
    dismissBtn.textContent = "Dismiss";
    dismissBtn.style.cssText = "padding:6px 12px;font:600 11.5px 'Geist',sans-serif;color:#a1a1aa;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;cursor:pointer;";

    const importBtn = document.createElement("button");
    importBtn.textContent = "Import & paste";
    importBtn.style.cssText = "padding:6px 12px;font:600 11.5px 'Geist',sans-serif;color:#fff;background:linear-gradient(135deg,#8b5cf6,#c084fc);border:1px solid rgba(167,139,250,0.55);border-radius:8px;cursor:pointer;";

    dismissBtn.addEventListener("click", () => host.remove());
    importBtn.addEventListener("click", () => {
      host.remove();
      try { onAccept(); } catch (e) { warn("onAccept failed", e); }
    });

    btnRow.appendChild(dismissBtn);
    btnRow.appendChild(importBtn);
    host.appendChild(title);
    host.appendChild(meta);
    host.appendChild(btnRow);
    document.documentElement.appendChild(host);

    setTimeout(() => host.remove(), 30000);
  }

  // ── Clipboard poll ────────────────────────────────────────────
  async function readClipboard() {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) return null;
      return await navigator.clipboard.readText();
    } catch (_) {
      // NotAllowedError expected when tab lacks focus. Silent retry on next event.
      return null;
    }
  }

  async function checkClipboard() {
    const text = await readClipboard();
    if (!text || text.length < 50) return;
    if (!RELAY_HEADER.test(text)) return;

    const hash = hashText(text);
    if (wasRecentlySeen(hash)) { log("relay payload already seen, skipping"); return; }

    const auto = window.__tokenPilotAutoPaste;
    if (!auto || typeof auto.run !== "function") { warn("autopaste not ready"); return; }

    const targetKey = auto.targetKeyForHost();
    if (!targetKey) { log("current host not a supported target"); return; }

    log("relay payload detected, prompting user");

    showImportPrompt(text, () => {
      markSeen(hash);
      const payload = {
        target:     targetKey,
        content:    text,
        autoSubmit: false, // user reviews before send when importing external chat
        createdAt:  Date.now()
      };
      chrome.storage.local.set({ [auto.STORAGE_KEY]: payload }, () => {
        if (chrome.runtime.lastError) { warn("storage.set failed:", chrome.runtime.lastError); return; }
        auto.run();
      });
    });
  }

  // Poll on focus + on load. Focus event covers: user copies in terminal,
  // switches to browser tab.
  window.addEventListener("focus", checkClipboard);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkClipboard();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkClipboard, { once: true });
  } else {
    // Small delay lets autopaste.js finish attaching its global handle.
    setTimeout(checkClipboard, 400);
  }
})();
