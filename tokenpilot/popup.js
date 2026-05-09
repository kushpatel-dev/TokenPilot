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
    if (isEnabled) {
      pill.className = "status";
      text.textContent = "ACTIVE";
    } else {
      pill.className = "status off";
      text.textContent = "DISABLED";
    }
  }

  // ── Token estimator — mirrors tokenCounter.js heuristic ──────
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

    // Step 1 — get active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setMsg("No active tab found.", "err");
        btn.disabled = false;
        return;
      }

      // Step 2 — ask content script to scrape the page
      chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_CONVERSATION" }, (res) => {

        // Catch "Could not establish connection" errors
        if (chrome.runtime.lastError) {
          console.warn("[TokenPilot] sendMessage error:", chrome.runtime.lastError.message);
          setMsg("Reload the AI page, then try again.", "err");
          btn.disabled = false;
          return;
        }

        btn.disabled = false;

        if (!res) {
          setMsg("No response from page.", "err");
          return;
        }

        const { messages, platform, model } = res;

        if (!messages || messages.length === 0) {
          setMsg("No conversation found on this page.", "err");
          return;
        }

        // Step 3 — build Markdown (.md) file
        const date   = new Date().toLocaleString();
        const aiName = model    || "AI";
        const host   = platform || tab.url || "Unknown";

        // YAML frontmatter — structured metadata every AI reads
        const frontmatter =
          "---\n" +
          "title: TokenPilot Chat Transfer\n" +
          "platform: " + host + "\n" +
          "model: " + aiName + "\n" +
          "exported: " + date + "\n" +
          "messages: " + messages.length + "\n" +
          "---\n\n";

        // Instruction block for the receiving AI
        const instructions =
          "> **Instructions for the receiving AI**\n" +
          "> This conversation was originally held with **" + aiName + "** on `" + host + "`.\n" +
          "> Read every message carefully, absorb all context, then continue\n" +
          "> as the AI assistant — picking up exactly where the chat left off.\n" +
          "> Start your reply with a one-line recap of what was discussed.\n" +
          "\n---\n\n## Conversation Transcript\n\n";

        // One markdown section per turn
        let body = "";
        for (let i = 0; i < messages.length; i++) {
          const m       = messages[i];
          const heading = m.role === "You" ? "### 🧑 You" : "### 🤖 " + aiName;
          const divider = i > 0 ? "\n---\n\n" : "";
          body += divider + heading + "\n\n" + m.text + "\n\n";
        }

        // Step 4 — token estimate on the full file
        const contentSoFar  = frontmatter + instructions + body;
        const tokenEstimate = estimateTokens(contentSoFar);
        const fmtTok        = fmtTokens(tokenEstimate);

        // Footer with etm token count at the bottom
        const footer =
          "\n---\n\n" +
          "## ▶ Continue from here\n\n" +
          "_Paste your next message below after uploading this file to a new chat._\n\n" +
          "---\n\n" +
          "<!-- TokenPilot Transfer Metadata\n" +
          "     etm: " + fmtTok + " tokens used by this file\n" +
          "     exact: " + tokenEstimate + " tokens (estimated, cl100k_base)\n" +
          "     messages: " + messages.length + "\n" +
          "     model: " + aiName + "\n" +
          "     exported: " + date + "\n" +
          "-->\n";

        const content  = contentSoFar + footer;

        // Step 5 — download as .md
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

        // Step 6 — show result in popup
        setMsg("✓ " + messages.length + " msgs · etm: " + fmtTok + " tokens", "ok");
        setTimeout(() => setMsg(""), 5000);
      });
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