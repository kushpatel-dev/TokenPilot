const MODEL_DB = {
  "gpt-4o":         { limit: 128000, name: "GPT-4o" },
  "gpt-4o-mini":    { limit: 128000, name: "GPT-4o mini" },
  "gpt-4.5":        { limit: 128000, name: "GPT-4.5" },
  "gpt-4-turbo":    { limit: 128000, name: "GPT-4 Turbo" },
  "gpt-4":          { limit: 8192,   name: "GPT-4" },
  "gpt-3.5":        { limit: 16385,  name: "GPT-3.5 Turbo" },
  "o1":             { limit: 200000, name: "o1" },
  "o1-mini":        { limit: 128000, name: "o1-mini" },
  "o3-mini":        { limit: 200000, name: "o3-mini" },
  "opus":           { limit: 200000, name: "Claude Opus" },
  "sonnet":         { limit: 200000, name: "Claude Sonnet" },
  "haiku":          { limit: 200000, name: "Claude Haiku" },
  "claude-3":       { limit: 200000, name: "Claude 3" },
  "claude-3.5":     { limit: 200000, name: "Claude 3.5" },
  "claude-4":       { limit: 200000, name: "Claude 4" },
  "gemini-2":       { limit: 1048576, name: "Gemini 2.0" },
  "gemini-1.5":     { limit: 1048576, name: "Gemini 1.5" },
  "gemini pro":     { limit: 1048576, name: "Gemini Pro" },
  "gemini flash":   { limit: 1048576, name: "Gemini Flash" },
  "gemini":         { limit: 1048576, name: "Gemini" },
  "mistral large":  { limit: 128000, name: "Mistral Large" },
  "mistral":        { limit: 32768,  name: "Mistral" },
  "llama-3":        { limit: 8192,   name: "Llama 3" },
  "llama 3":        { limit: 8192,   name: "Llama 3" },
  "llama-4":        { limit: 128000, name: "Llama 4" },
  "deepseek":       { limit: 128000, name: "DeepSeek" },
  "deepseek-v3":    { limit: 128000, name: "DeepSeek V3" },
  "deepseek-r1":    { limit: 128000, name: "DeepSeek R1" },
  "sonar":          { limit: 127072, name: "Sonar" },
  "command-r":      { limit: 128000, name: "Command R" },
};

const PLATFORM_DATA = {
  "chatgpt.com":      "Free: ~10 msgs / 5h",
  "openai.com":       "Free: ~10 msgs / 5h",
  "claude.ai":        "Free: Resets every 5h",
  "github.com":       "Free: 2K inline / mo",
  "gemini.google.com":"Free: Tiered Rate Limits",
  "arena.ai":         "Arena: Context Shared",
  "perplexity.ai":    "Free: 5 Pro / 4h"
};

const DEFAULT_LIMIT = 128000;
const HISTORY_KEY = "aih_prompt_history";
const MAX_HISTORY = 4;

let detectedModel = null;
let detectedLimit = DEFAULT_LIMIT;
let currentInput = null;
let isCollapsed = false;
let lastKnownPrompt = "";
let detectedPlatformInfo = "";
let aihObserver = null;
let aihInterval = null;

console.log("🧠 TokenPilot v3.0 loaded!");

// ============================================================
//  Model detection
// ============================================================
function detectModel() {
  const hostname = window.location.hostname;
  let modelText = "";

  if (hostname.includes("chatgpt") || hostname.includes("chat.openai")) {
    const selectors = ['button[aria-label*="Model"]','[data-testid="model-switcher"]','span[class*="model"]','div[class*="model-selector"]','button[class*="model"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { modelText = el.textContent.trim().toLowerCase(); break; }
    }
    if (!modelText) {
      for (const btn of document.querySelectorAll('button')) {
        const t = btn.textContent.toLowerCase();
        if (t.includes('gpt-4') || t.includes('gpt-3') || t.includes('o1') || t.includes('o3')) { modelText = t; break; }
      }
    }
    if (!modelText) modelText = "gpt-4o";
  } else if (hostname.includes("claude")) {
    const selectors = ['button[data-testid="model-selector"]','[class*="model-selector"]','button[class*="ModelPicker"]','div[class*="model-name"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { modelText = el.textContent.trim().toLowerCase(); break; }
    }
    if (!modelText) {
      for (const el of document.querySelectorAll('button, span, div')) {
        const t = el.textContent.toLowerCase();
        if ((t.includes('opus') || t.includes('sonnet') || t.includes('haiku')) && t.length < 50) { modelText = t; break; }
      }
    }
    if (!modelText) modelText = "sonnet";
  } else if (hostname.includes("gemini")) {
    const el = document.querySelector('mat-select, [class*="model"], button[aria-label*="model"]');
    if (el) modelText = el.textContent.trim().toLowerCase();
    if (!modelText) modelText = "gemini-2";
  } else if (hostname.includes("deepseek")) { modelText = "deepseek"; }
  else if (hostname.includes("perplexity")) { modelText = "sonar"; }
  else if (hostname.includes("mistral")) { modelText = "mistral"; }
  else { modelText = "unknown"; }

  // Set platform info based on hostname
  detectedPlatformInfo = "";
  for (const [domain, info] of Object.entries(PLATFORM_DATA)) {
    if (hostname.includes(domain)) {
      detectedPlatformInfo = info;
      break;
    }
  }

  for (const [key, val] of Object.entries(MODEL_DB)) {
    if (modelText.includes(key)) {
      detectedModel = val.name;
      detectedLimit = val.limit;
      return;
    }
  }
  detectedModel = modelText || "Unknown";
  detectedLimit = DEFAULT_LIMIT;
}

// ============================================================
//  Token estimation & readability
// ============================================================
function estimateTokens(text) {
  if (!text || !text.trim()) return 0;
  const words = text.trim().split(/\s+/).length;
  const specialChars = (text.match(/[^\w\s]/g) || []).length;
  return Math.ceil((words + specialChars * 0.5) * 1.3);
}

function getReadability(text) {
  if (!text || !text.trim()) return null;
  const words = text.trim().split(/\s+/);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgWordsPerSentence = sentences.length ? words.length / sentences.length : words.length;
  const longWords = words.filter(w => w.length > 8).length;
  const complexRatio = longWords / words.length;

  if (avgWordsPerSentence > 25 || complexRatio > 0.35) return { label: "Complex", color: "#f97316", tip: "Consider shorter sentences" };
  if (avgWordsPerSentence > 15 || complexRatio > 0.2)  return { label: "Moderate", color: "#facc15", tip: "Good balance" };
  return { label: "Simple", color: "#22d3ee", tip: "Clear & direct" };
}

// ============================================================
//  Prompt History (localStorage)
// ============================================================
function saveToHistory(text) {
  if (!text || text.trim().length < 100) return;
  try {
    let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    history = history.filter(h => h !== text.trim());
    history.unshift(text.trim());
    history = history.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {}
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (e) { return []; }
}

// ============================================================
//  Input helpers
// ============================================================
function getInputText(el) {
  if (!el) return "";
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
  return el.innerText || el.textContent || "";
}

function setInputText(el, text) {
  if (!el) return;
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.focus();
    el.innerText = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function findPromptInput() {
  const selectors = [
    '#prompt-textarea', 'div[id="prompt-textarea"]', 'div.ql-editor[contenteditable="true"]',
    '.text-input-area textarea', 'rich-textarea div[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]', 'fieldset div[contenteditable="true"]',
    'textarea[placeholder*="Ask"]', '#chat-input', 'textarea#chat-input',
    'textarea[class*="TextArea"]', 'textarea[rows]', 'textarea',
    'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

// ============================================================
//  Format helpers
// ============================================================
function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(0) + "K";
  return n.toString();
}

// ============================================================
//  Create the UI
// ============================================================
function createUI() {
  if (document.getElementById("ai-helper-box")) return;

  const box = document.createElement("div");
  box.id = "ai-helper-box";
  box.innerHTML = `
    <div class="aih-header">
      <div class="aih-logo">
        <div class="aih-logo-icon">⚡</div>
        <span>TokenPilot</span>
        <div class="aih-status-dot"></div>
      </div>
      <button class="aih-toggle-btn" title="Collapse/Expand">−</button>
    </div>

    <div class="aih-body">

      <!-- Token Counter -->
      <div class="aih-token-section">
        <div class="aih-token-row">
          <span class="aih-token-label">Tokens Used</span>
          <span class="aih-token-value" id="aih-token-count">0</span>
        </div>
        <div class="aih-progress-track">
          <div class="aih-progress-fill" id="aih-progress-fill"></div>
        </div>
        <div class="aih-model-row">
          <span class="aih-detected-model" id="aih-detected-model">🔍 Detecting...</span>
          <span class="aih-limit-label" id="aih-limit-label">Limit: ${formatNumber(detectedLimit)}</span>
        </div>
        <!-- Readability badge -->
        <div class="aih-readability" id="aih-readability" style="display:none;">
          <span class="aih-read-label">Readability:</span>
          <span class="aih-read-value" id="aih-read-value">—</span>
          <span class="aih-read-tip" id="aih-read-tip"></span>
        </div>
      </div>

      <!-- Error / Success -->
      <div class="aih-error" id="aih-error"></div>

      <!-- Prompt History -->
      <div class="aih-history-section" id="aih-history-section" style="display:none;">
        <div class="aih-history-header">
          <span class="aih-token-label">🕓 Recent Prompts</span>
          <button class="aih-history-clear" id="aih-history-clear">All Clear</button>
        </div>
        <div class="aih-history-list" id="aih-history-list"></div>
      </div>

    </div>
  `;

  document.body.appendChild(box);
  bindEvents();
  detectModel();
  updateModelDisplay();
  renderHistory();

  setInterval(() => {
    detectModel();
    updateModelDisplay();
  }, 5000);
}

// ============================================================
//  Bind events
// ============================================================
function bindEvents() {
  // Collapse toggle
  document.querySelector(".aih-toggle-btn").addEventListener("click", () => {
    isCollapsed = !isCollapsed;
    const body = document.querySelector(".aih-body");
    body.classList.toggle("hidden", isCollapsed);
    document.querySelector(".aih-toggle-btn").textContent = isCollapsed ? "+" : "−";
  });

  // Clear history
  document.getElementById("aih-history-clear").addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });
}

// ============================================================
//  Render prompt history
// ============================================================
function renderHistory() {
  const history = getHistory();
  const section = document.getElementById("aih-history-section");
  const list = document.getElementById("aih-history-list");
  if (!section || !list) return;

  if (history.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  list.innerHTML = "";

  history.forEach((entry, i) => {
    const item = document.createElement("div");
    item.className = "aih-history-item";
    const preview = entry.length > 55 ? entry.slice(0, 55) + "…" : entry;
    item.innerHTML = `
      <span class="aih-history-preview" title="${entry.replace(/"/g, '&quot;')}">${preview}</span>
      <button class="aih-history-restore" data-index="${i}">↩</button>
    `;
    item.querySelector(".aih-history-restore").addEventListener("click", () => {
      if (currentInput) {
        setInputText(currentInput, history[i]);
        updateTokenDisplay();
        showSuccess("✅ Prompt restored!");
      }
    });
    list.appendChild(item);
  });
}

// ============================================================
//  Update token display + readability
// ============================================================
function updateTokenDisplay() {
  if (!currentInput) return;
  const text = getInputText(currentInput);
  const tokens = estimateTokens(text);
  const pct = Math.min((tokens / detectedLimit) * 100, 100);

  const countEl = document.getElementById("aih-token-count");
  const fillEl = document.getElementById("aih-progress-fill");
  if (!countEl || !fillEl) return;

  countEl.textContent = tokens.toLocaleString();
  fillEl.style.width = pct + "%";
  countEl.className = "aih-token-value";
  fillEl.className = "aih-progress-fill";

  if (pct > 80) { countEl.classList.add("danger"); fillEl.classList.add("danger"); }
  else if (pct > 50) { countEl.classList.add("warning"); fillEl.classList.add("warning"); }

  // Readability
  const readEl = document.getElementById("aih-readability");
  const readValue = document.getElementById("aih-read-value");
  const readTip = document.getElementById("aih-read-tip");
  if (text.trim().length > 15 && readEl && readValue && readTip) {
    const r = getReadability(text);
    if (r) {
      readValue.textContent = r.label;
      readValue.style.color = r.color;
      readTip.textContent = "· " + r.tip;
      readEl.style.display = "flex";
    }
  } else if (readEl) {
    readEl.style.display = "none";
  }
}

function updateModelDisplay() {
  const modelEl = document.getElementById("aih-detected-model");
  const limitEl = document.getElementById("aih-limit-label");
  if (modelEl) modelEl.textContent = `🤖 ${detectedModel || "Detecting..."}`;
  
  if (limitEl) {
    // If we have platform-specific info, show it, otherwise show context limit
    limitEl.textContent = detectedPlatformInfo || `Limit: ${formatNumber(detectedLimit)}`;
  }
  updateTokenDisplay();
}

// ============================================================
//  UI Helpers
// ============================================================
function showError(msg) {
  const el = document.getElementById("aih-error");
  el.style.background = "";
  el.style.borderColor = "";
  el.style.color = "";
  el.textContent = "⚠️ " + msg;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 8000);
}

function showSuccess(msg) {
  const el = document.getElementById("aih-error");
  if (!el) return;
  el.textContent = msg;
  el.style.background = "rgba(16, 185, 129, 0.1)";
  el.style.borderColor = "rgba(16, 185, 129, 0.15)";
  el.style.color = "#34d399";
  el.classList.add("visible");
  setTimeout(() => {
    el.classList.remove("visible");
    el.style.background = "";
    el.style.borderColor = "";
    el.style.color = "";
  }, 2000);
}

// ============================================================
//  Input listener
// ============================================================
function attachInputListener(el) {
  if (!el || el.dataset.aihAttached) return;
  el.dataset.aihAttached = "true";
  currentInput = el;

  const handler = () => {
    const text = getInputText(el);
    
    // Auto-save logic: if input is cleared, save the last known text
    if (text.trim().length === 0 && lastKnownPrompt.trim().length > 10) {
      saveToHistory(lastKnownPrompt);
      renderHistory();
      lastKnownPrompt = ""; 
    } else if (text.trim().length > 0) {
      lastKnownPrompt = text;
    }

    updateTokenDisplay();
  };

  el.addEventListener("input", handler);
  el.addEventListener("keyup", handler);

  // Enter key detection
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const text = getInputText(el);
      if (text.trim().length > 10) {
        saveToHistory(text);
        renderHistory();
        lastKnownPrompt = ""; 
      }
    }
  });

  el.addEventListener("focus", () => {
    currentInput = el;
    updateTokenDisplay();
  });
  updateTokenDisplay();
}

// ============================================================
//  Init & State Management
// ============================================================
function removeUI() {
  const box = document.getElementById("ai-helper-box");
  if (box) box.remove();
  
  // Stop background processes
  if (aihObserver) { aihObserver.disconnect(); aihObserver = null; }
  if (aihInterval) { clearInterval(aihInterval); aihInterval = null; }

  // Clean up input listeners
  const inputs = document.querySelectorAll('[data-aih-attached]');
  inputs.forEach(input => {
    delete input.dataset.aihAttached;
  });
}

function init() {
  chrome.storage.local.get(['isEnabled'], (result) => {
    if (result.isEnabled === false) return;
    
    // Safety: clear any existing interval before starting new one
    if (aihInterval) clearInterval(aihInterval);

    let retries = 0;
    function tryAttach() {
      const input = findPromptInput();
      if (input) {
        createUI();
        attachInputListener(input);
        startObserver();
        return true;
      }
      return false;
    }

    if (tryAttach()) return;

    aihInterval = setInterval(() => {
      retries++;
      if (tryAttach() || retries >= 100) {
        clearInterval(aihInterval);
        aihInterval = null;
        if (retries >= 100) startObserver();
      }
    }, 500);
  });
}

function startObserver() {
  if (aihObserver) aihObserver.disconnect();

  aihObserver = new MutationObserver(() => {
    const input = findPromptInput();
    if (input && !input.dataset.aihAttached) {
      chrome.storage.local.get(['isEnabled'], (result) => {
        if (result.isEnabled !== false) {
          createUI();
          attachInputListener(input);
        }
      });
    }
  });
  aihObserver.observe(document.body, { childList: true, subtree: true });
}

// Listen for power toggle from popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.isEnabled) {
    if (changes.isEnabled.newValue === false) {
      removeUI();
    } else {
      init();
    }
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
