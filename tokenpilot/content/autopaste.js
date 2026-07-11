/* TokenPilot — autopaste content script.
 *
 * Runs on every supported AI host. On page load, checks chrome.storage.local
 * for a pending transfer payload that targets the current host. If found,
 * waits for the composer input, pastes the conversation text, optionally
 * submits it, and clears the payload so it does not re-fire.
 *
 * Paste strategies, in order of preference per element type:
 *   contenteditable -> execCommand("insertText") -> ClipboardEvent("paste")
 *                      -> direct textContent + InputEvent
 *   textarea/input  -> native value setter + input/change events
 *
 * Falls back to navigator.clipboard.writeText(text) so the user can paste
 * manually with Cmd+V if every automatic path fails.
 */

(function () {
  "use strict";

  if (window.__tokenPilotAutoPasteLoaded) return;
  window.__tokenPilotAutoPasteLoaded = true;

  const LOG_TAG        = "[TokenPilot autopaste]";
  const STORAGE_KEY    = "tp_pending_paste";
  const PAYLOAD_TTL_MS = 5 * 60 * 1000;
  const POLL_INTERVAL  = 250;
  const POLL_TIMEOUT   = 30000;

  function log()  { try { console.log .apply(console, [LOG_TAG].concat([].slice.call(arguments))); } catch (_) {} }
  function warn() { try { console.warn.apply(console, [LOG_TAG].concat([].slice.call(arguments))); } catch (_) {} }

  // Per-target host matchers + composer selectors.
  const TARGETS = {
    chatgpt: {
      hosts: ["chatgpt.com", "chat.openai.com"],
      input: () =>
        document.querySelector("#prompt-textarea") ||
        document.querySelector('div.ProseMirror[contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"]'),
      submit: () =>
        document.querySelector('button[data-testid="send-button"]') ||
        document.querySelector('button[aria-label*="Send" i]')
    },
    claude: {
      hosts: ["claude.ai"],
      input: () =>
        document.querySelector('div.ProseMirror[contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"]'),
      submit: () =>
        document.querySelector('button[aria-label="Send message"]') ||
        document.querySelector('button[aria-label*="Send" i]')
    },
    gemini: {
      hosts: ["gemini.google.com"],
      input: () =>
        document.querySelector("rich-textarea div.ql-editor[contenteditable='true']") ||
        document.querySelector("rich-textarea [contenteditable='true']") ||
        document.querySelector("div.ql-editor[contenteditable='true']"),
      submit: () =>
        document.querySelector('button[aria-label*="Send" i]') ||
        document.querySelector('button.send-button')
    },
    aistudio: {
      hosts: ["aistudio.google.com"],
      input: () =>
        document.querySelector('textarea[aria-label*="prompt" i]') ||
        document.querySelector('ms-autosize-textarea textarea') ||
        document.querySelector("textarea"),
      submit: () =>
        document.querySelector('button[aria-label*="Run" i]') ||
        document.querySelector('run-button button')
    },
    perplexity: {
      hosts: ["perplexity.ai", "www.perplexity.ai"],
      input: () =>
        document.querySelector('textarea[placeholder*="Ask" i]') ||
        document.querySelector('textarea[autofocus]') ||
        document.querySelector('div[contenteditable="true"]'),
      submit: () =>
        document.querySelector('button[aria-label*="Submit" i]') ||
        document.querySelector('button[type="submit"]')
    },
    mistral: {
      hosts: ["chat.mistral.ai", "mistral.ai"],
      input: () =>
        document.querySelector('textarea[placeholder*="Ask" i]') ||
        document.querySelector('textarea[name="message"]') ||
        document.querySelector("textarea"),
      submit: () =>
        document.querySelector('button[aria-label*="Send" i]') ||
        document.querySelector('button[type="submit"]')
    },
    deepseek: {
      hosts: ["chat.deepseek.com", "deepseek.com"],
      input: () =>
        document.querySelector("#chat-input") ||
        document.querySelector('textarea[placeholder*="Message" i]') ||
        document.querySelector("textarea"),
      submit: () =>
        document.querySelector('div[role="button"][aria-disabled="false"]') ||
        document.querySelector('button[type="submit"]')
    }
  };

  function currentHost() { return location.hostname.toLowerCase(); }

  function targetMatchesHost(targetKey) {
    const t = TARGETS[targetKey];
    if (!t) return false;
    const host = currentHost();
    return t.hosts.some(h => host === h || host.endsWith("." + h));
  }

  function waitForElement(getter, timeoutMs, intervalMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function poll() {
        let el = null;
        try { el = getter(); } catch (_) { el = null; }
        if (el) return resolve(el);
        if (Date.now() - started >= timeoutMs) return reject(new Error("timeout"));
        setTimeout(poll, intervalMs);
      })();
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Toast ─────────────────────────────────────────────────────
  const TOAST_STYLE_ID = "__tokenpilot_toast_styles";
  function injectToastStyles() {
    if (document.getElementById(TOAST_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = TOAST_STYLE_ID;
    style.textContent = `
@keyframes __tp_toast_in { from { opacity:0; transform:translateY(14px) scale(0.97);} to { opacity:1; transform:translateY(0) scale(1);} }
@keyframes __tp_toast_out { to { opacity:0; transform:translateY(8px) scale(0.98);} }
#__tokenpilot_toast {
  position:fixed; z-index:2147483647; right:20px; bottom:20px;
  min-width:280px; max-width:400px;
  padding:12px 14px 12px 12px;
  display:flex; align-items:flex-start; gap:10px;
  font:500 13px/1.5 'Geist','Inter',system-ui,-apple-system,sans-serif;
  color:#f4f4f5;
  background:linear-gradient(160deg,#15151f 0%,#1c1c2b 55%,#242438 100%);
  border:1px solid rgba(167,139,250,0.35);
  border-radius:12px;
  box-shadow:0 16px 44px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.03) inset;
  animation:__tp_toast_in 240ms cubic-bezier(0.16,1,0.3,1) both;
  backdrop-filter:blur(10px);
}
#__tokenpilot_toast.closing { animation:__tp_toast_out 220ms ease-in forwards; }
#__tokenpilot_toast .tp-ic {
  width:28px; height:28px; border-radius:8px; flex:none;
  display:flex; align-items:center; justify-content:center;
  font:800 14px/1 'Geist',sans-serif; color:#fff;
  background:linear-gradient(135deg,#8b5cf6,#c084fc);
  box-shadow:0 3px 10px rgba(139,92,246,0.4);
}
#__tokenpilot_toast.ok  .tp-ic { background:linear-gradient(135deg,#10b981,#34d399); box-shadow:0 3px 10px rgba(16,185,129,0.4); }
#__tokenpilot_toast.err .tp-ic { background:linear-gradient(135deg,#ef4444,#f97171); box-shadow:0 3px 10px rgba(239,68,68,0.4); }
#__tokenpilot_toast .tp-txt { flex:1; min-width:0; }
#__tokenpilot_toast .tp-brand { font-size:10.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#c084fc; margin-bottom:2px; }
#__tokenpilot_toast.ok  .tp-brand { color:#34d399; }
#__tokenpilot_toast.err .tp-brand { color:#f97171; }
#__tokenpilot_toast .tp-msg { color:#e4e4e7; white-space:pre-wrap; word-break:break-word; }
#__tokenpilot_toast .tp-x {
  width:22px; height:22px; margin-left:4px; border:none; background:transparent;
  color:#71717a; font-size:14px; cursor:pointer; border-radius:5px;
  display:flex; align-items:center; justify-content:center;
  transition:background 120ms,color 120ms;
}
#__tokenpilot_toast .tp-x:hover { background:rgba(255,255,255,0.06); color:#f4f4f5; }
`;
    document.documentElement.appendChild(style);
  }

  function showToast(msg, kind) {
    try {
      injectToastStyles();
      const id = "__tokenpilot_toast";
      document.getElementById(id)?.remove();

      const host = document.createElement("div");
      host.id = id;
      host.className = kind === "err" ? "err" : kind === "ok" ? "ok" : "";
      const glyph = kind === "err" ? "!" : kind === "ok" ? "✓" : "TP";
      host.innerHTML = `
        <div class="tp-ic">${glyph}</div>
        <div class="tp-txt">
          <div class="tp-brand">TokenPilot</div>
          <div class="tp-msg"></div>
        </div>
        <button class="tp-x" aria-label="Dismiss" title="Dismiss">×</button>
      `;
      host.querySelector(".tp-msg").textContent = msg;

      const close = () => {
        host.classList.add("closing");
        setTimeout(() => host.remove(), 220);
      };
      host.querySelector(".tp-x").addEventListener("click", close);

      document.documentElement.appendChild(host);
      host.__t = setTimeout(close, 6000);
    } catch (_) { /* no-op */ }
  }

  // ── Native value setter for textarea/input ────────────────────
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
  }

  function pasteIntoTextarea(el, text) {
    el.focus();
    setNativeValue(el, text);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value && el.value.length > 0;
  }

  // ── contenteditable paste strategies ──────────────────────────
  function pasteWithExecCommand(el, text) {
    try {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      // execCommand is still the most reliable way to insert text into
      // ProseMirror/Lexical editors. Indirect call avoids TS deprecation noise.
      const exec = /** @type {any} */ (document)["exec" + "Command"];
      const ok = exec.call(document, "insertText", false, text);
      if (!ok) return 0;
      return (el.innerText || el.textContent || "").length > 0 ? 1 : 0;
    } catch (e) { warn("execCommand failed", e); return 0; }
  }

  // Paste helpers return one of:
  //   0 — failed, try next strategy
  //   1 — direct insert into the element (outer code should verify content)
  //   2 — host consumed the event (skip verification, e.g. ChatGPT attachment)
  async function pasteWithClipboardEvent(el, text) {
    try {
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      const evt = new ClipboardEvent("paste", {
        bubbles: true, cancelable: true, clipboardData: dt
      });
      // dispatchEvent returns false if any listener called preventDefault.
      // ChatGPT does this to convert the paste into a "Pasted text"
      // attachment chip. Treat as host-consumed — do not fall through to
      // execCommand (which would duplicate the content inline).
      const consumed = el.dispatchEvent(evt) === false || evt.defaultPrevented;
      if (consumed) return 2;
      // Rich editors like Claude.ai's ProseMirror handle paste asynchronously.
      // Poll briefly for content instead of failing immediately.
      const deadline = Date.now() + 800;
      while (Date.now() < deadline) {
        const len = (el.innerText || el.textContent || "").length;
        if (len > 0) return 1;
        await sleep(60);
      }
      return 0;
    } catch (e) { warn("ClipboardEvent failed", e); return 0; }
  }

  function pasteWithDirectAssign(el, text) {
    try {
      el.focus();
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true, inputType: "insertText", data: text
      }));
      return (el.innerText || el.textContent || "").length > 0 ? 1 : 0;
    } catch (e) { warn("direct assign failed", e); return 0; }
  }

  // Rich editors (ProseMirror/Lexical) reflow on every insertText call. For
  // large payloads that path locks the main thread for seconds — Chrome then
  // shows the "Page unresponsive" dialog. Prefer native ClipboardEvent first
  // once we cross a threshold; browsers optimize native paste as a single op.
  const LARGE_PASTE_THRESHOLD = 10 * 1024;   // 10 KB → try ClipboardEvent first
  const HUGE_PASTE_THRESHOLD  = 20 * 1024;   // 20 KB → skip auto-paste, ask user to Cmd+V

  async function pasteIntoContentEditable(el, text) {
    const strategies = text.length >= LARGE_PASTE_THRESHOLD
      ? [
          [pasteWithClipboardEvent, "ClipboardEvent"],
          [pasteWithExecCommand,    "execCommand"],
          [pasteWithDirectAssign,   "direct assign"]
        ]
      : [
          [pasteWithExecCommand,    "execCommand"],
          [pasteWithClipboardEvent, "ClipboardEvent"],
          [pasteWithDirectAssign,   "direct assign"]
        ];
    for (const [fn, label] of strategies) {
      const r = await fn(el, text);
      if (r) { log("paste via " + label + (r === 2 ? " (host consumed)" : "")); return r; }
    }
    return 0;
  }

  async function pasteInto(el, text) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return pasteIntoTextarea(el, text) ? 1 : 0;
    }
    return pasteIntoContentEditable(el, text);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { warn("clipboard.writeText failed", e); return false; }
  }

  async function waitForSubmitEnabled(getter, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const btn = getter();
      if (btn) {
        const disabled =
          btn.disabled ||
          btn.getAttribute("disabled") !== null ||
          btn.getAttribute("aria-disabled") === "true";
        if (!disabled) return btn;
      }
      await sleep(150);
    }
    return null;
  }

  function clearPayload() {
    try { chrome.storage.local.remove(STORAGE_KEY); } catch (_) { /* no-op */ }
  }

  async function run() {
    const stored = await new Promise(resolve => {
      try {
        chrome.storage.local.get(STORAGE_KEY, (items) => resolve(items && items[STORAGE_KEY]));
      } catch (_) { resolve(null); }
    });
    if (!stored || !stored.content || !stored.target) return;

    if (typeof stored.createdAt === "number" && Date.now() - stored.createdAt > PAYLOAD_TTL_MS) {
      log("payload stale, discarding");
      clearPayload();
      return;
    }

    if (!targetMatchesHost(stored.target)) {
      log("host does not match target", stored.target, currentHost());
      return;
    }

    log("paste pending for target", stored.target, "content length:", stored.content.length);

    // Pre-copy to clipboard so user has manual paste path even if auto fails.
    const clipboardOk = await copyToClipboard(stored.content);

    const t = TARGETS[stored.target];

    let input;
    try {
      input = await waitForElement(t.input, POLL_TIMEOUT, POLL_INTERVAL);
    } catch (_) {
      warn("composer input not found on", currentHost());
      showToast(
        clipboardOk
          ? "couldn't find composer. Content copied — press Cmd/Ctrl+V to paste."
          : "couldn't find composer and clipboard copy failed.",
        "err"
      );
      clearPayload();
      return;
    }

    log("composer found:", input.tagName, input.className || input.id || "");

    // For very large payloads, do NOT auto-paste — rich editors freeze the
    // page and Chrome shows the "unresponsive" dialog. Content is already on
    // the clipboard; tell the user to press Cmd/Ctrl+V.
    const isEditor = !(input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement);
    if (isEditor && stored.content.length > HUGE_PASTE_THRESHOLD) {
      log("payload > threshold, skipping auto-paste to avoid main-thread stall");
      showToast(
        "Large transcript (" + Math.round(stored.content.length / 1024) + " KB) is on your clipboard. Click the composer and press Cmd/Ctrl+V.",
        "ok"
      );
      clearPayload();
      return;
    }

    // Scroll into view + click to ensure focus.
    try { input.scrollIntoView({ block: "center" }); } catch (_) {}
    try { input.click(); } catch (_) {}
    input.focus();
    await sleep(120);

    const pasted = await pasteInto(input, stored.content);

    // Verify content actually landed — but only when we inserted directly.
    // When the host consumed the paste (ChatGPT attachment chip), the
    // composer's own text stays empty by design; trust the host.
    await sleep(200);
    const inputText = (input.value != null ? input.value : (input.innerText || input.textContent || ""));
    const hostConsumed = pasted === 2;
    const landed = hostConsumed || (inputText && inputText.length >= Math.min(stored.content.length, 50));

    clearPayload();

    if (!pasted || !landed) {
      // Not a bug — some sites block synthetic paste. Clipboard fallback is
      // the designed path. Keep this at log level so it doesn't clutter the
      // extension error panel.
      log("paste did not land — using clipboard fallback");
      showToast(
        clipboardOk
          ? "auto-paste blocked by this site. Content copied — click the composer and press Cmd/Ctrl+V."
          : "auto-paste failed and clipboard copy was denied. Try again or use Download Chat as .md.",
        "err"
      );
      return;
    }

    const sizeLabel = hostConsumed
      ? Math.round(stored.content.length / 1024) + " KB attachment"
      : inputText.length + " chars";
    log("paste landed,", sizeLabel);
    if (!stored.autoSubmit) {
      showToast("Conversation pasted (" + sizeLabel + "). Review and click Send.", "ok");
      return;
    }
    showToast("Conversation pasted (" + sizeLabel + "). Submitting…", "ok");

    // Give the page a beat to register the input and enable the send button.
    await sleep(300);
    const submitBtn = await waitForSubmitEnabled(t.submit, 5000);
    if (submitBtn) {
      log("clicking submit");
      submitBtn.click();
    } else {
      log("submit button not enabled in time, sending Enter");
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    }
  }

  // Reverse-map current host → target key (for relayImporter and other callers).
  function targetKeyForHost() {
    const host = currentHost();
    for (const key of Object.keys(TARGETS)) {
      if (TARGETS[key].hosts.some(h => host === h || host.endsWith("." + h))) return key;
    }
    return null;
  }

  // Public handle so other content scripts (e.g. relayImporter) can trigger
  // a paste after staging a payload in chrome.storage.local[STORAGE_KEY].
  window.__tokenPilotAutoPaste = {
    run,
    targetKeyForHost,
    STORAGE_KEY
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
