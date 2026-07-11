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

  // ── Styles (injected once) ────────────────────────────────────
  const STYLE_ID = "__tokenpilot_relay_styles";
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
@keyframes __tp_slide_in { from { opacity:0; transform:translateY(12px) scale(0.98);} to { opacity:1; transform:translateY(0) scale(1);} }
@keyframes __tp_shimmer { 0% { background-position:-200% 0;} 100% { background-position:200% 0;} }
@keyframes __tp_pulse { 0%,100% { box-shadow:0 0 0 0 rgba(167,139,250,0.35);} 50% { box-shadow:0 0 0 6px rgba(167,139,250,0);} }
#__tokenpilot_relay_card {
  position:fixed; z-index:2147483647; right:20px; bottom:20px;
  width:360px; max-width:calc(100vw - 40px);
  padding:0; overflow:hidden;
  font:500 13px/1.5 'Geist','Inter',system-ui,-apple-system,sans-serif;
  color:#ededf0;
  background:linear-gradient(160deg,#15151f 0%,#1c1c2b 55%,#242438 100%);
  border:1px solid rgba(167,139,250,0.35);
  border-radius:16px;
  box-shadow:0 20px 60px rgba(0,0,0,0.55),0 0 0 1px rgba(255,255,255,0.03) inset;
  animation:__tp_slide_in 260ms cubic-bezier(0.16,1,0.3,1) both;
  backdrop-filter:blur(12px);
}
#__tokenpilot_relay_card .tp-accent {
  height:3px;
  background:linear-gradient(90deg,#8b5cf6,#c084fc,#e879f9,#c084fc,#8b5cf6);
  background-size:200% 100%;
  animation:__tp_shimmer 3s linear infinite;
}
#__tokenpilot_relay_card .tp-body { padding:16px 18px 14px; }
#__tokenpilot_relay_card .tp-head { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
#__tokenpilot_relay_card .tp-logo {
  width:32px; height:32px; border-radius:9px; flex:none;
  background:linear-gradient(135deg,#8b5cf6,#c084fc);
  display:flex; align-items:center; justify-content:center;
  color:#fff; font:800 15px/1 'Geist',sans-serif;
  box-shadow:0 4px 12px rgba(139,92,246,0.4);
  animation:__tp_pulse 2.4s ease-out infinite;
}
#__tokenpilot_relay_card .tp-title { font-weight:700; font-size:14px; color:#f4f4f5; letter-spacing:-0.01em; }
#__tokenpilot_relay_card .tp-sub { font-size:11.5px; color:#a1a1aa; margin-top:1px; }
#__tokenpilot_relay_card .tp-close {
  margin-left:auto; width:24px; height:24px; border-radius:6px;
  background:transparent; border:none; color:#71717a; font-size:15px;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  transition:background 120ms,color 120ms;
}
#__tokenpilot_relay_card .tp-close:hover { background:rgba(255,255,255,0.06); color:#f4f4f5; }
#__tokenpilot_relay_card .tp-chips { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
#__tokenpilot_relay_card .tp-chip {
  padding:3px 8px; font:600 10.5px/1.4 'Geist',sans-serif;
  color:#c4b5fd; background:rgba(139,92,246,0.14);
  border:1px solid rgba(167,139,250,0.28); border-radius:999px;
  letter-spacing:0.02em; text-transform:uppercase;
}
#__tokenpilot_relay_card .tp-chip.neutral { color:#a1a1aa; background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.08); }
#__tokenpilot_relay_card .tp-preview {
  padding:10px 12px; margin-bottom:12px;
  font:400 12px/1.55 'SF Mono','JetBrains Mono',ui-monospace,monospace;
  color:#d4d4d8; background:rgba(0,0,0,0.28);
  border:1px solid rgba(255,255,255,0.06); border-radius:8px;
  display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical;
  overflow:hidden; word-break:break-word;
}
#__tokenpilot_relay_card .tp-btns { display:flex; gap:8px; }
#__tokenpilot_relay_card .tp-btn {
  flex:1; padding:9px 14px; font:600 12.5px/1 'Geist',sans-serif;
  border-radius:9px; cursor:pointer; letter-spacing:0.01em;
  transition:transform 120ms,box-shadow 160ms,background 160ms,border-color 160ms;
}
#__tokenpilot_relay_card .tp-btn.primary {
  color:#fff; background:linear-gradient(135deg,#8b5cf6,#c084fc);
  border:1px solid rgba(192,132,252,0.55);
  box-shadow:0 6px 16px rgba(139,92,246,0.35);
}
#__tokenpilot_relay_card .tp-btn.primary:hover { transform:translateY(-1px); box-shadow:0 10px 22px rgba(139,92,246,0.5); }
#__tokenpilot_relay_card .tp-btn.primary:active { transform:translateY(0); }
#__tokenpilot_relay_card .tp-btn.ghost {
  color:#d4d4d8; background:rgba(255,255,255,0.04);
  border:1px solid rgba(255,255,255,0.09);
}
#__tokenpilot_relay_card .tp-btn.ghost:hover { background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.14); color:#f4f4f5; }
`;
    document.documentElement.appendChild(style);
  }

  function formatBytes(n) {
    n = parseInt(n, 10) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  function parseRelayMeta(text) {
    const m = { source: "cli", bytes: 0, ts: null };
    const src = text.match(/<!--\s*source:\s*([^\s]+)\s*-->/);
    const byt = text.match(/<!--\s*bytes:\s*(\d+)\s*-->/);
    const ts  = text.match(/<!--\s*ts:\s*([^\s]+)\s*-->/);
    if (src) m.source = src[1];
    if (byt) m.bytes  = parseInt(byt[1], 10);
    if (ts)  m.ts     = ts[1];
    return m;
  }

  function firstUserSnippet(text) {
    const body = text.replace(/<!--[\s\S]*?-->/g, "");
    // Prefer first "## User" or "### User" or "**User**" block.
    const m = body.match(/(?:^|\n)#{2,3}\s*(?:user|human)[^\n]*\n+([\s\S]+?)(?:\n#{1,3}\s|\n\*\*|$)/i);
    let snippet = (m ? m[1] : body).replace(/^\s+/, "");
    snippet = snippet.replace(/```[\s\S]*?```/g, "[code]");
    snippet = snippet.replace(/`([^`]+)`/g, "$1");
    snippet = snippet.replace(/\s+/g, " ").trim();
    return snippet.slice(0, 180) + (snippet.length > 180 ? "…" : "");
  }

  // ── Import prompt card ────────────────────────────────────────
  function showImportPrompt(text, onAccept) {
    injectStyles();

    const id = "__tokenpilot_relay_card";
    document.getElementById(id)?.remove();

    const meta = parseRelayMeta(text);
    const bytes = meta.bytes || text.length;
    const preview = firstUserSnippet(text) || "Chat transcript ready to import.";

    const host = document.createElement("div");
    host.id = id;
    host.innerHTML = `
      <div class="tp-accent"></div>
      <div class="tp-body">
        <div class="tp-head">
          <div class="tp-logo">TP</div>
          <div style="min-width:0;">
            <div class="tp-title">Import chat from clipboard</div>
            <div class="tp-sub">TokenPilot detected a relay payload</div>
          </div>
          <button class="tp-close" aria-label="Dismiss" title="Dismiss">×</button>
        </div>
        <div class="tp-chips">
          <span class="tp-chip">${meta.source}</span>
          <span class="tp-chip neutral">${formatBytes(bytes)}</span>
          ${meta.ts ? `<span class="tp-chip neutral">${meta.ts.replace("T"," ").replace("Z","")}</span>` : ""}
        </div>
        <div class="tp-preview"></div>
        <div class="tp-btns">
          <button class="tp-btn ghost" data-act="dismiss">Dismiss</button>
          <button class="tp-btn primary" data-act="import">Import &amp; paste</button>
        </div>
      </div>
    `;
    // Preview is textContent (not innerHTML) to avoid injection from clipboard.
    host.querySelector(".tp-preview").textContent = preview;

    const dismiss = () => host.remove();
    host.querySelector('[data-act="dismiss"]').addEventListener("click", dismiss);
    host.querySelector(".tp-close").addEventListener("click", dismiss);
    host.querySelector('[data-act="import"]').addEventListener("click", () => {
      host.remove();
      try { onAccept(); } catch (e) { warn("onAccept failed", e); }
    });

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
      // Strip TokenPilot relay header comments so the composer receives clean
      // markdown, not <!-- TOKENPILOT-RELAY:v1 --> noise at the top.
      const clean = text.replace(/^(?:<!--[\s\S]*?-->\s*\n?)+/, "").replace(/^\s+/, "");
      const payload = {
        target:     targetKey,
        content:    clean,
        autoSubmit: false, // user reviews before send when importing external chat
        createdAt:  Date.now()
      };
      // Guard against invalidated extension context (stale content script
      // after the extension is reloaded). Fall back to clipboard + tell user
      // to hard-refresh the page.
      if (!chrome.runtime?.id) {
        warn("extension context invalidated — reload this tab");
        navigator.clipboard.writeText(clean).catch(() => {});
        alert("TokenPilot was reloaded. Reload this page (Cmd+Shift+R), then run /relay again.");
        return;
      }
      try {
        chrome.storage.local.set({ [auto.STORAGE_KEY]: payload }, () => {
          if (chrome.runtime.lastError) { warn("storage.set failed:", chrome.runtime.lastError); return; }
          auto.run();
        });
      } catch (e) {
        warn("storage.set threw:", e);
        navigator.clipboard.writeText(clean).catch(() => {});
      }
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
