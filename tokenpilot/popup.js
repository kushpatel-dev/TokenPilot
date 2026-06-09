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

  // ── Token estimator ───────────────────────────────────────────
  function estimateTokens(text) {
    if (!text || !text.trim()) return 0;
    const words        = text.trim().split(/\s+/).length;
    const specialChars = (text.match(/[^\w\s]/g) || []).length;
    return Math.ceil((words + specialChars * 0.5) * 1.3);
  }
  function fmtTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }

  // ── Build Markdown file with embedded images ──────────────────
  function buildMarkdown(messages, aiName, host, date) {

    // Pull first user message + last AI message for briefing block
    const firstUser = messages.find(m => m.role === "You");
    const lastAI    = [...messages].reverse().find(m => m.role !== "You");
    const origAsk   = firstUser ? firstUser.text.split("\n")[0].slice(0, 150) : "See transcript below";
    const lastLeft  = lastAI    ? lastAI.text.split("\n")[0].slice(0, 150)    : "See transcript below";

    const frontmatter =
      "---\n" +
      "title: TokenPilot Chat Transfer\n" +
      "platform: " + host + "\n" +
      "model: " + aiName + "\n" +
      "exported: " + date + "\n" +
      "messages: " + messages.length + "\n" +
      "---\n\n";

    // Briefing block — gives receiving AI instant context (matches Tally format)
    const briefing =
      "## Briefing\n\n" +
      "You are continuing a working session that began on **" + host + "** with **" + aiName + "**. " +
      "Read the full transcript below and pick up exactly where the previous assistant left off — " +
      "don't re-introduce yourself, match the user's working style.\n\n" +
      "**Original ask:**\n" +
      "> " + origAsk + "\n\n" +
      "**Where the previous assistant left off:**\n" +
      "> " + lastLeft + "…\n\n" +
      "---\n\n";

    const instructions =
      "> **Instructions for the receiving AI**\n" +
      "> This conversation was originally held with **" + aiName + "** on `" + host + "`.\n" +
      "> Read every message carefully, absorb all context (including any images below),\n" +
      "> then continue as the AI assistant — picking up exactly where the chat left off.\n" +
      "> Start your reply with a one-line recap of what was discussed.\n" +
      "\n---\n\n## Conversation Transcript\n\n";

    let body = "";
    let imgIndex = 1;

    for (let i = 0; i < messages.length; i++) {
      const m       = messages[i];
      const heading = m.role === "You" ? "### \uD83E\uDDD1 You" : "### \uD83E\uDD16 " + aiName;
      const divider = i > 0 ? "\n---\n\n" : "";

      // Text block
      body += divider + heading + "\n\n";
      if (m.text) body += m.text + "\n\n";

      // Image references — role-aware labels, no base64
      if (m.images && m.images.length > 0) {
        for (const desc of m.images) {
          const prefix = m.role === "You" ? "User uploaded" : "AI generated image";
          body += "[" + prefix + ": " + desc + "]\n\n";
          imgIndex++;
        }
      }
    }

    // Token estimate on full content
    const contentSoFar  = frontmatter + briefing + instructions + body;
    const tokenEstimate = estimateTokens(contentSoFar);
    const fmtTok        = fmtTokens(tokenEstimate);

    const footer =
      "\n---\n\n" +
      "## \u25B6 Continue from here\n\n" +
      "_Paste your next message below after uploading this file to a new chat._\n\n" +
      "---\n\n" +
      "<!-- TokenPilot Transfer Metadata\n" +
      "     etm: " + fmtTok + " tokens used by this file\n" +
      "     exact: " + tokenEstimate + " tokens (estimated, cl100k_base)\n" +
      "     messages: " + messages.length + "\n" +
      "     images: " + (imgIndex - 1) + " embedded\n" +
      "     model: " + aiName + "\n" +
      "     exported: " + date + "\n" +
      "-->\n";

    return { content: contentSoFar + footer, fmtTok, tokenEstimate, imgCount: imgIndex - 1 };
  }

  // ── Download the .md file ─────────────────────────────────────
  function downloadMd(content, host) {
    const blob     = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement("a");
    const safeName = host.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 30);
    a.href         = url;
    a.download     = "tokenpilot-transfer-" + safeName + "-" + Date.now() + ".md";
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

  // ── Scrape and build ──────────────────────────────────────────
  function doScrape(tab, setMsg, btn) {

    function handleResponse(res) {
      btn.disabled = false;

      if (!res || !res.messages || res.messages.length === 0) {
        setMsg("No conversation found on this page.", "err");
        return;
      }

      const { messages, platform, model } = res;
      const date   = new Date().toLocaleString();
      const aiName = model    || "AI";
      const host   = platform || tab.url || "Unknown";

      setMsg("Building .md file…");

      const { content, fmtTok, imgCount } = buildMarkdown(messages, aiName, host, date);
      downloadMd(content, host);

      // Status: show message count + token count + image count
      const imgNote = imgCount > 0 ? " · " + imgCount + " image" + (imgCount > 1 ? "s" : "") : "";
      setMsg("\u2713 " + messages.length + " msgs · etm: " + fmtTok + " tokens" + imgNote, "ok");
      setTimeout(() => setMsg(""), 6000);
    }

    // Guard: bail immediately if not an AI chat page — no Chrome API calls, no errors panel warnings
    if (!tab.url || !isAllowedTab(tab.url)) {
      btn.disabled = false;
      setMsg("Open an AI chat page first.", "err");
      return;
    }

    // Inject scripts (content.js guards prevent double-init)
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ["data/models.js", "utils/tokenCounter.js", "content/content.js"]
    }, () => {
      if (chrome.runtime.lastError) {
        btn.disabled = false;
        setMsg("Cannot access this page. Open an AI chat first.", "err");
        return;
      }
      // Brief delay so the (re-)injected script initialises, then scrape
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_CONVERSATION" }, (res) => {
          if (chrome.runtime.lastError || !res) {
            btn.disabled = false;
            setMsg("Reload the AI page, then try again.", "err");
            return;
          }
          handleResponse(res);
        });
      }, 400);
    });
  }

  // ── Transfer Chat ─────────────────────────────────────────────
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
      doScrape(tab, setMsg, btn);
    });
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    const toggle   = document.getElementById("power-toggle");
    const tokensEl = document.getElementById("total-tokens");
    const countEl  = document.getElementById("prompt-count");
    const xferBtn  = document.getElementById("transfer-btn");

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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();