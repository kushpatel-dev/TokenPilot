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
  function showToast(msg, kind) {
    try {
      const id = "__tokenpilot_toast";
      let host = document.getElementById(id);
      if (!host) {
        host = document.createElement("div");
        host.id = id;
        host.style.cssText = [
          "position:fixed", "z-index:2147483647",
          "right:20px", "bottom:20px",
          "padding:10px 14px",
          "font:600 13px/1.4 'Geist',system-ui,-apple-system,sans-serif",
          "color:#fff",
          "background:linear-gradient(135deg,#8b5cf6,#c084fc)",
          "border:1px solid rgba(167,139,250,0.6)",
          "border-radius:10px",
          "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
          "max-width:380px",
          "pointer-events:none",
          "white-space:pre-wrap"
        ].join(";");
        document.documentElement.appendChild(host);
      }
      host.textContent = "TokenPilot: " + msg;
      if (kind === "err") {
        host.style.background = "linear-gradient(135deg,#ef4444,#f97171)";
        host.style.borderColor = "rgba(239,68,68,0.6)";
      } else if (kind === "ok") {
        host.style.background = "linear-gradient(135deg,#10b981,#34d399)";
        host.style.borderColor = "rgba(16,185,129,0.6)";
      }
      clearTimeout(host.__t);
      host.__t = setTimeout(() => { host.remove(); }, 6000);
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
      if (!ok) return false;
      return (el.innerText || el.textContent || "").length > 0;
    } catch (e) { warn("execCommand failed", e); return false; }
  }

  function pasteWithClipboardEvent(el, text) {
    try {
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      const evt = new ClipboardEvent("paste", {
        bubbles: true, cancelable: true, clipboardData: dt
      });
      el.dispatchEvent(evt);
      return (el.innerText || el.textContent || "").length > 0;
    } catch (e) { warn("ClipboardEvent failed", e); return false; }
  }

  function pasteWithDirectAssign(el, text) {
    try {
      el.focus();
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true, inputType: "insertText", data: text
      }));
      return (el.innerText || el.textContent || "").length > 0;
    } catch (e) { warn("direct assign failed", e); return false; }
  }

  function pasteIntoContentEditable(el, text) {
    if (pasteWithExecCommand(el, text))      { log("paste via execCommand");      return true; }
    if (pasteWithClipboardEvent(el, text))   { log("paste via ClipboardEvent");   return true; }
    if (pasteWithDirectAssign(el, text))     { log("paste via direct assign");    return true; }
    return false;
  }

  function pasteInto(el, text) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return pasteIntoTextarea(el, text);
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

    // Scroll into view + click to ensure focus.
    try { input.scrollIntoView({ block: "center" }); } catch (_) {}
    try { input.click(); } catch (_) {}
    input.focus();
    await sleep(120);

    const pasted = pasteInto(input, stored.content);

    // Verify content actually landed.
    await sleep(200);
    const inputText = (input.value != null ? input.value : (input.innerText || input.textContent || ""));
    const landed    = inputText && inputText.length >= Math.min(stored.content.length, 50);

    clearPayload();

    if (!pasted || !landed) {
      warn("paste did not land. fallback to clipboard.");
      showToast(
        clipboardOk
          ? "auto-paste blocked by this site. Content copied — click the composer and press Cmd/Ctrl+V."
          : "auto-paste failed and clipboard copy was denied. Try again or use Download Chat as .md.",
        "err"
      );
      return;
    }

    log("paste landed,", inputText.length, "chars");
    if (!stored.autoSubmit) {
      showToast("Conversation pasted (" + inputText.length + " chars). Review and click Send.", "ok");
      return;
    }
    showToast("conversation pasted (" + inputText.length + " chars). Submitting…", "ok");

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
