(function () {
  "use strict";

  function fmtNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K";
    return n.toLocaleString();
  }

  function setStatus(isEnabled) {
    const pill = document.getElementById("status-pill");
    const text = document.getElementById("status-text");
    if (!pill || !text) return;
    pill.className   = isEnabled ? "status" : "status off";
    text.textContent = isEnabled ? "ACTIVE" : "DISABLED";
  }

  // ── Token estimator: uses estimateTokens from utils/tokenCounter.js
  //    (loaded by popup.html before this script).
  function fmtTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }

  // ── YAML scalar escape (quoted, double-quote + backslash safe) ──
  function yamlEscape(v) {
    const s = String(v == null ? "" : v);
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  // ── Smart truncate: word-boundary cut, ellipsis only when actually cut ──
  function smartTruncate(text, max) {
    const s = String(text == null ? "" : text).trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    const trimmed = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
    return trimmed.trimEnd() + "…";
  }

  // ── Build Markdown file with embedded images ──────────────────
  function buildMarkdown(messages, aiName, host, date) {

    const isoDate = new Date().toISOString();

    const firstUser   = messages.find(m => m.role === "You");
    const lastAI      = [...messages].reverse().find(m => m.role !== "You");
    const firstLine   = (t) => String(t || "").split("\n").find(l => l.trim()) || "";
    const origAsk     = firstUser ? smartTruncate(firstLine(firstUser.text), 150) : "See transcript below";
    const lastLeft    = lastAI    ? smartTruncate(firstLine(lastAI.text),    150) : "See transcript below";

    const frontmatter =
      "---\n" +
      "title: " + yamlEscape("TokenPilot Chat Transfer") + "\n" +
      "platform: " + yamlEscape(host) + "\n" +
      "model: " + yamlEscape(aiName) + "\n" +
      "exported: " + yamlEscape(isoDate) + "\n" +
      "exported_human: " + yamlEscape(date) + "\n" +
      "messages: " + messages.length + "\n" +
      "---\n\n";

    const briefing =
      "## Briefing\n\n" +
      "You are continuing a working session that began on **" + host + "** with **" + aiName + "**. " +
      "Read the full transcript below and pick up exactly where the previous assistant left off — " +
      "don't re-introduce yourself, match the user's working style.\n\n" +
      "**Original ask:**\n" +
      "> " + origAsk + "\n\n" +
      "**Where the previous assistant left off:**\n" +
      "> " + lastLeft + "\n\n" +
      "---\n\n";

    const instructions =
      "> **Instructions for the receiving AI**\n" +
      "> This conversation was originally held with **" + aiName + "** on `" + host + "`.\n" +
      "> Read every message carefully, absorb all context (including any images below),\n" +
      "> then continue as the AI assistant — picking up exactly where the chat left off.\n" +
      "> Start your reply with a one-line recap of what was discussed.\n" +
      "\n---\n\n## Conversation Transcript\n\n";

    let body = "";
    let imgCount = 0;

    for (let i = 0; i < messages.length; i++) {
      const m       = messages[i];
      const n       = i + 1;
      const heading = m.role === "You"
        ? "### " + n + ". You"
        : "### " + n + ". Assistant (" + aiName + ")";
      const divider = i > 0 ? "\n<hr class=\"tp-msg-break\"/>\n\n" : "";

      body += divider + heading + "\n\n";
      if (m.text) {
        // Escape leading "---" lines so user text can't collide with MD
        // horizontal-rule / YAML-block parsing in the transcript.
        body += m.text.replace(/^---(?=\s|$)/gm, "\\---") + "\n\n";
      }

      if (m.images && m.images.length > 0) {
        for (const desc of m.images) {
          const prefix = m.role === "You" ? "User uploaded" : "AI generated image";
          body += "[" + prefix + ": " + desc + "]\n\n";
          imgCount++;
        }
      }
    }

    const contentSoFar  = frontmatter + briefing + instructions + body;
    const tokenEstimate = estimateTokens(contentSoFar);
    const fmtTok        = fmtTokens(tokenEstimate);

    const footer =
      "\n---\n\n" +
      "## ▶ Continue from here\n\n" +
      "_Paste your next message below after uploading this file to a new chat._\n\n" +
      "---\n\n" +
      "<!-- TokenPilot Transfer Metadata\n" +
      "     tokens_pretty: " + fmtTok + "\n" +
      "     tokens_exact: " + tokenEstimate + " (heuristic estimate, ~cl100k-calibrated)\n" +
      "     images_referenced: " + imgCount + "\n" +
      "-->\n";

    return { content: contentSoFar + footer, fmtTok, tokenEstimate, imgCount };
  }

  // ── Human-readable filename timestamp: 2026-06-20-1542 ───────
  function fmtFilenameStamp(d = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
           "-" + pad(d.getHours()) + pad(d.getMinutes());
  }

  // ── Download the .md file ─────────────────────────────────────
  function downloadMd(content, host) {
    const blob     = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement("a");
    const safeName = host.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 30);
    a.href         = url;
    a.download     = "tokenpilot-transfer-" + safeName + "-" + fmtFilenameStamp() + ".md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Allowed AI hosts (must match manifest host_permissions) ──
  const ALLOWED_HOSTS = [
    "chat.openai.com", "chatgpt.com",
    "claude.ai",
    "gemini.google.com", "aistudio.google.com",
    "perplexity.ai", "www.perplexity.ai",
    "mistral.ai", "chat.mistral.ai",
    "deepseek.com", "chat.deepseek.com",
    "github.com",
    "arena.ai",
  ];
  function isAllowedTab(url) {
    try {
      const host = new URL(url).hostname;
      return ALLOWED_HOSTS.some(h => host === h || host.endsWith("." + h));
    } catch { return false; }
  }

  // ── Target AI registry (host + new-chat URL) ──────────────────
  const TARGETS = {
    chatgpt:    { name: "ChatGPT",    url: "https://chatgpt.com/" },
    claude:     { name: "Claude",     url: "https://claude.ai/new" },
    gemini:     { name: "Gemini",     url: "https://gemini.google.com/app" },
    aistudio:   { name: "AI Studio",  url: "https://aistudio.google.com/prompts/new_chat" },
    perplexity: { name: "Perplexity", url: "https://www.perplexity.ai/" },
    mistral:    { name: "Mistral",    url: "https://chat.mistral.ai/chat" },
    deepseek:   { name: "DeepSeek",   url: "https://chat.deepseek.com/" }
  };

  function statusSummary(r) {
    const imgNote = r.imgCount > 0 ? " · " + r.imgCount + " image" + (r.imgCount > 1 ? "s" : "") : "";
    return "✓ " + r.messages + " msgs · etm: " + r.fmtTok + " tokens" + imgNote;
  }

  // ── Scrape and build payload from active tab ──────────────────
  // onResult({ ok, content?, fmtTok?, imgCount?, messages?, host?, error? })
  function doScrape(tab, setMsg, btn, onResult) {

    function finish(payload) {
      btn.disabled = false;
      onResult(payload);
    }

    function handleResponse(res) {
      if (!res || !res.messages || res.messages.length === 0) {
        finish({ ok: false, error: "No conversation found on this page." });
        return;
      }

      const { messages, platform, model } = res;
      const date   = new Date().toLocaleString();
      const aiName = model    || "AI";
      const host   = platform || tab.url || "Unknown";

      setMsg("Building transfer payload…");

      const built = buildMarkdown(messages, aiName, host, date);
      finish({
        ok:       true,
        content:  built.content,
        fmtTok:   built.fmtTok,
        imgCount: built.imgCount,
        messages: messages.length,
        host:     host
      });
    }

    if (!tab.url || !isAllowedTab(tab.url)) {
      finish({ ok: false, error: "Open an AI chat page first." });
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ["data/models.js", "utils/tokenCounter.js", "content/content.js"]
    }, () => {
      if (chrome.runtime.lastError) {
        finish({ ok: false, error: "Cannot access this page. Open an AI chat first." });
        return;
      }
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_CONVERSATION" }, (res) => {
          if (chrome.runtime.lastError || !res) {
            finish({ ok: false, error: "Reload the AI page, then try again." });
            return;
          }
          handleResponse(res);
        });
      }, 400);
    });
  }

  // ── Transfer Chat (download .md) ──────────────────────────────
  function transferChat() {
    const btn      = document.getElementById("transfer-btn");
    const statusEl = document.getElementById("transfer-status");

    function setMsg(msg, type) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className   = "transfer-status" + (type ? " " + type : "");
    }

    btn.disabled = true;
    setMsg("Reading conversation…");

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setMsg("No active tab found.", "err");
        btn.disabled = false;
        return;
      }
      doScrape(tab, setMsg, btn, (r) => {
        if (!r.ok) { setMsg(r.error, "err"); return; }
        downloadMd(r.content, r.host);
        setMsg(statusSummary(r), "ok");
        setTimeout(() => setMsg(""), 6000);
      });
    });
  }

  // ── Send to AI (auto-paste into new tab) ──────────────────────
  function sendToAI() {
    const btn       = document.getElementById("send-btn");
    const selectEl  = document.getElementById("target-select");
    const statusEl  = document.getElementById("transfer-status");
    const targetKey = selectEl ? selectEl.value : "chatgpt";
    const target    = TARGETS[targetKey];

    function setMsg(msg, type) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className   = "transfer-status" + (type ? " " + type : "");
    }

    if (!target) { setMsg("Unknown target.", "err"); return; }

    btn.disabled = true;
    setMsg("Reading conversation…");

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setMsg("No active tab found.", "err");
        btn.disabled = false;
        return;
      }
      doScrape(tab, setMsg, btn, (r) => {
        if (!r.ok) { setMsg(r.error, "err"); return; }

        const payload = {
          target:     targetKey,
          content:    r.content,
          autoSubmit: true,
          createdAt:  Date.now()
        };

        setMsg("Opening " + target.name + "…");

        chrome.storage.local.set({ tp_pending_paste: payload }, () => {
          if (chrome.runtime.lastError) {
            setMsg("Failed to stage payload.", "err");
            return;
          }
          chrome.tabs.create({ url: target.url, active: true }, () => {
            setMsg(statusSummary(r) + " · sent to " + target.name, "ok");
            setTimeout(() => setMsg(""), 6000);
          });
        });
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    const toggle   = document.getElementById("power-toggle");
    const tokensEl = document.getElementById("total-tokens");
    const countEl  = document.getElementById("prompt-count");
    const xferBtn  = document.getElementById("transfer-btn");
    const sendBtn  = document.getElementById("send-btn");

    if (!toggle) return;

    try {
      chrome.runtime.sendMessage({ type: "GET_STATS" }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        toggle.checked = res.isEnabled;
        setStatus(res.isEnabled);
        if (tokensEl) tokensEl.textContent = fmtNum(res.totalTokens || 0);
        if (countEl)  countEl.textContent  = fmtNum(res.promptCount || 0);
      });
    } catch (e) {
      console.error("[TokenPilot] popup init error:", e);
    }

    toggle.addEventListener("change", () => {
      const val = toggle.checked;
      chrome.runtime.sendMessage({ type: "SET_ENABLED", value: val });
      setStatus(val);
    });

    if (xferBtn) xferBtn.addEventListener("click", transferChat);
    if (sendBtn) sendBtn.addEventListener("click", sendToAI);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
