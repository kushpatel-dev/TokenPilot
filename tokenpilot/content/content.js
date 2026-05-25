// ============================================================
//  TokenPilot v3.3 — Content Script (redesigned UI)
//  Vanilla JS. Deps injected via manifest: data/models.js, utils/tokenCounter.js
// ============================================================
"use strict";

console.log("[TokenPilot] v3.3 loaded");

// ── Constants ────────────────────────────────────────────────
const HISTORY_KEY  = "tp_prompt_history";
const THEME_KEY    = "tp_theme";
const TAB_KEY      = "tp_tab";
const COMPARE_KEY  = "tp_compare";
const MAX_HISTORY  = 50;
const DEFAULT_COMPARE = ["gpt-4o", "sonnet", "gemini-2"];

// ── State ────────────────────────────────────────────────────
let detectedModel    = null;
let detectedLimit    = DEFAULT_LIMIT;
let detectedPlatform = "";
let detectedModelKey = "gpt-4o";
let currentInput     = null;
let isCollapsed      = false;
let lastKnownPrompt  = "";
let currentTab       = localStorage.getItem(TAB_KEY) || "tokens";
let currentTheme     = localStorage.getItem(THEME_KEY) || "dark";
let searchQuery      = "";
let compareModels    = JSON.parse(localStorage.getItem(COMPARE_KEY) || "null") || DEFAULT_COMPARE;
let aihObserver      = null;
let aihInterval      = null;
let flashTimer       = null;
let toastTimer       = null;

// ── SVG icon helper ─────────────────────────────────────────
const ICONS = {
  flash:   `<path d="M13 2 3 14h7v8l10-12h-7V2z" fill="currentColor"/>`,
  minus:   `<path d="M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  plus:    `<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  sun:     `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></g>`,
  moon:    `<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  copy:    `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></g>`,
  restore: `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></g>`,
  trash:   `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></g>`,
  search:  `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>`,
  download:`<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></g>`,
  gauge:   `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3.05 11a9 9 0 1 1 0 2"/><path d="M12 14 8 10"/><circle cx="12" cy="14" r="1.5" fill="currentColor"/></g>`,
  history: `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></g>`,
  compare: `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></g>`,
  check:   `<path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  close:   `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></g>`,
};
function svg(name, size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${ICONS[name] || ""}</svg>`;
}

// ── Model Detection (unchanged) ──────────────────────────────
function detectModel() {
  try {
    const host = window.location.hostname;
    let modelText = "";
    for (const [domain, data] of Object.entries(PLATFORM_DATA)) {
      if (host.includes(domain)) {
        detectedPlatform = data.info;
        if (!modelText) modelText = data.defaultModel;
        break;
      }
    }
    if (host.includes("chatgpt") || host.includes("chat.openai")) {
      const selectors = [
        'button[aria-label*="Model"]',
        '[data-testid="model-switcher"]',
        'button[aria-haspopup="listbox"]',
        '[class*="ModelSwitcher"]',
        '[class*="modelSelector"]',
        '[class*="model-switcher"]',
        'span[class*="model"]',
        'button[class*="model"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent.trim()) { modelText = el.textContent.trim().toLowerCase(); break; }
      }
    } else if (host.includes("claude")) {
      const selectors = ['button[data-testid="model-selector"]','[class*="model-selector"]','button[class*="ModelPicker"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent.trim()) { modelText = el.textContent.trim().toLowerCase(); break; }
      }
    } else if (host.includes("gemini")) {
      const el = document.querySelector('mat-select, [class*="model"], button[aria-label*="model"]');
      if (el) modelText = el.textContent.trim().toLowerCase();
    }
    for (const [key, val] of Object.entries(MODEL_DB)) {
      if (modelText.includes(key)) {
        detectedModel = val.name;
        detectedLimit = val.limit;
        detectedModelKey = key;
        return;
      }
    }
    detectedModel = modelText || "Unknown";
    detectedLimit = DEFAULT_LIMIT;
  } catch (e) { console.warn("[TokenPilot] detectModel error:", e); }
}

// ── History helpers ──────────────────────────────────────────
function saveToHistory(text) {
  if (!text || text.trim().length < 10) return;
  try {
    let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    history = history.filter(h => (typeof h === "string" ? h : h.text) !== text.trim());
    history.unshift({ text: text.trim(), tokens: estimateTokens(text), ts: Date.now() });
    history = history.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    const tokens = estimateTokens(text);
    chrome.runtime.sendMessage({ type: "PROMPT_SUBMITTED", tokens }).catch(() => {});
  } catch (e) { console.warn("[TokenPilot] saveToHistory error:", e); }
}
function getHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return raw.map(h => typeof h === "string" ? { text: h, tokens: estimateTokens(h), ts: Date.now() } : h);
  } catch { return []; }
}
function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "now";
  if (m < 60) return m + "m";
  if (m < 1440) return Math.floor(m / 60) + "h";
  return Math.floor(m / 1440) + "d";
}

// ── DOM input helpers (unchanged) ────────────────────────────
function getInputText(el) {
  if (!el) return "";
  try {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    return el.innerText || el.textContent || "";
  } catch { return ""; }
}
function setInputText(el, text) {
  if (!el) return;
  try {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.focus();
      el.innerText = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch (e) { console.warn("[TokenPilot] setInputText error:", e); }
}
function findPromptInput() {
  const selectors = [
    "#prompt-textarea", 'div[id="prompt-textarea"]',
    "div.ql-editor[contenteditable=\"true\"]",
    ".text-input-area textarea",
    "rich-textarea div[contenteditable=\"true\"]",
    "div.ProseMirror[contenteditable=\"true\"]",
    "fieldset div[contenteditable=\"true\"]",
    'textarea[placeholder*="Ask"]', "#chat-input", "textarea#chat-input",
    'textarea[class*="TextArea"]', "textarea[rows]", "textarea",
    'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]',
  ];
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    } catch {}
  }
  return null;
}

// ── Build UI ─────────────────────────────────────────────────
function createUI() {
  if (document.getElementById("tp-box")) return;
  const box = document.createElement("div");
  box.id = "tp-box";
  if (currentTheme === "light") box.classList.add("tp-light");

  box.innerHTML = `
    <div class="tp-header">
      <div class="tp-brand">
        <div class="tp-logo">${svg("flash", 14)}</div>
        <div class="tp-brand-text">
          <div class="tp-brand-name">TokenPilot</div>
          <div class="tp-brand-host"><span class="tp-live-dot"></span><span id="tp-host-label">${window.location.hostname}</span></div>
        </div>
      </div>
      <div class="tp-header-actions">
        <button class="tp-iconbtn" id="tp-theme-btn" title="Toggle theme">${svg(currentTheme === "dark" ? "sun" : "moon", 14)}</button>
        <button class="tp-iconbtn" id="tp-collapse-btn" title="Collapse">${svg("minus", 14)}</button>
      </div>
    </div>

    <div class="tp-hero">
      <div class="tp-hero-ring">
        <svg width="76" height="76" viewBox="0 0 76 76" style="transform:rotate(-90deg)">
          <defs>
            <linearGradient id="tp-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#c084fc"/>
            </linearGradient>
            <linearGradient id="tp-grad-warn" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#f97316"/>
            </linearGradient>
            <linearGradient id="tp-grad-danger" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#ef4444"/>
            </linearGradient>
          </defs>
          <circle cx="38" cy="38" r="35.5" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="5"/>
          <circle id="tp-ring-fill" cx="38" cy="38" r="35.5" fill="none" stroke="url(#tp-grad)" stroke-width="5" stroke-linecap="round" stroke-dasharray="223" stroke-dashoffset="223" style="transition:stroke-dashoffset 0.5s cubic-bezier(.4,0,.2,1)"/>
        </svg>
        <div class="tp-hero-inner">
          <div class="tp-hero-num" id="tp-token-count">0</div>
          <div class="tp-hero-sub" id="tp-limit-sub">/ 128k</div>
        </div>
      </div>
      <div class="tp-hero-meta">
        <span class="tp-model-chip"><span class="tp-model-dot"></span><span id="tp-model-name">Detecting…</span></span>
        <div class="tp-hero-stats">
          <div><div class="tp-hero-stat-val" id="tp-pct-val">0%</div><div class="tp-hero-stat-lbl">used</div></div>
          <div><div class="tp-hero-stat-val" id="tp-free-val">128k</div><div class="tp-hero-stat-lbl">free</div></div>
        </div>
      </div>
    </div>

    <div class="tp-tabs" id="tp-tabs">
      <div class="tp-tabs-indicator" id="tp-tabs-indicator"></div>
      <button class="tp-tab" data-tab="tokens">${svg("gauge", 13)}<span>Live</span></button>
      <button class="tp-tab" data-tab="history">${svg("history", 13)}<span>History</span></button>
      <button class="tp-tab" data-tab="compare">${svg("compare", 13)}<span>Compare</span></button>
    </div>

    <div class="tp-tabbody">
      <div class="tp-pane tp-live" data-pane="tokens">
        <div class="tp-live-label"><span>Prompt</span><span class="tp-chars" id="tp-chars">0 chars · 0 words</span></div>
        <div id="tp-signals" class="tp-signals"></div>
        <div class="tp-analysis-tip" id="tp-tip" style="display:none"></div>
        <div class="tp-flash" id="tp-flash"></div>
      </div>

      <div class="tp-pane tp-history-pane" data-pane="history" style="display:none">
        <div class="tp-search">
          ${svg("search", 12)}
          <input type="text" id="tp-search-input" placeholder="Search prompts"/>
        </div>
        <div class="tp-history-list" id="tp-history-list"></div>
        <div class="tp-history-foot">
          <div class="tp-history-count" id="tp-history-count">0 saved</div>
          <div class="tp-history-foot-actions">
            <button class="tp-ghost-btn" id="tp-export-csv">${svg("download", 11)} CSV</button>
            <button class="tp-ghost-btn" id="tp-export-json">${svg("download", 11)} JSON</button>
            <button class="tp-ghost-btn tp-danger" id="tp-clear-all">${svg("trash", 11)} Clear</button>
          </div>
        </div>
      </div>

      <div class="tp-pane tp-compare" data-pane="compare" style="display:none">
        <div class="tp-compare-head" id="tp-compare-head">0 tokens · across models</div>
        <div class="tp-compare-list" id="tp-compare-list"></div>
      </div>
    </div>

    <div class="tp-toast" id="tp-toast">${svg("check", 12)}<span id="tp-toast-text">Done</span></div>
  `;

  document.body.appendChild(box);
  bindUIEvents();
  detectModel();
  setTab(currentTab, true);
  refreshAll();
  setInterval(() => { detectModel(); refreshAll(); }, 5000);
}

// ── Event bindings ──────────────────────────────────────────
function bindUIEvents() {
  const $ = id => document.getElementById(id);

  $("tp-theme-btn").addEventListener("click", () => {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, currentTheme);
    const box = document.getElementById("tp-box");
    box.classList.toggle("tp-light", currentTheme === "light");
    $("tp-theme-btn").innerHTML = svg(currentTheme === "dark" ? "sun" : "moon", 14);
  });

  $("tp-collapse-btn").addEventListener("click", () => {
    isCollapsed = !isCollapsed;
    const box = document.getElementById("tp-box");
    box.classList.toggle("is-collapsed", isCollapsed);
    $("tp-collapse-btn").innerHTML = svg(isCollapsed ? "plus" : "minus", 14);
  });

  document.querySelectorAll("#tp-tabs .tp-tab").forEach(btn => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  $("tp-search-input").addEventListener("input", e => {
    searchQuery = e.target.value;
    renderHistory();
  });

  $("tp-clear-all").addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    toast("Cleared");
  });
  $("tp-export-csv").addEventListener("click", () => exportHistory("csv"));
  $("tp-export-json").addEventListener("click", () => exportHistory("json"));
}

// ── Tab switching ────────────────────────────────────────────
function setTab(tab, instant = false) {
  currentTab = tab;
  localStorage.setItem(TAB_KEY, tab);
  document.querySelectorAll("#tp-tabs .tp-tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === tab));
  document.querySelectorAll(".tp-pane").forEach(p => p.style.display = p.dataset.pane === tab ? "" : "none");
  const activeBtn = document.querySelector(`#tp-tabs .tp-tab[data-tab="${tab}"]`);
  const indicator = document.getElementById("tp-tabs-indicator");
  if (activeBtn && indicator) {
    if (instant) indicator.style.transition = "none";
    indicator.style.left  = activeBtn.offsetLeft + "px";
    indicator.style.width = activeBtn.offsetWidth + "px";
    if (instant) requestAnimationFrame(() => { indicator.style.transition = ""; });
  }
  if (tab === "history") renderHistory();
  if (tab === "compare") renderCompare();
}

// ── Refresh all dynamic bits ─────────────────────────────────
function refreshAll() {
  updateTokenDisplay();
  const modelEl = document.getElementById("tp-model-name");
  if (modelEl) modelEl.textContent = detectedModel || "Detecting…";
}

// ── Live display ─────────────────────────────────────────────
function updateTokenDisplay() {
  try {
    const text = currentInput ? getInputText(currentInput) : "";
    const tokens = estimateTokens(text);
    const pct = Math.min((tokens / detectedLimit) * 100, 100);

    const countEl = document.getElementById("tp-token-count");
    const subEl   = document.getElementById("tp-limit-sub");
    const pctEl   = document.getElementById("tp-pct-val");
    const freeEl  = document.getElementById("tp-free-val");
    const charsEl = document.getElementById("tp-chars");
    const ringEl  = document.getElementById("tp-ring-fill");
    const box     = document.getElementById("tp-box");

    if (countEl) countEl.textContent = tokens.toLocaleString();
    if (subEl)   subEl.textContent   = "/ " + formatNumber(detectedLimit);
    if (pctEl)   pctEl.textContent   = pct.toFixed(1) + "%";
    if (freeEl)  freeEl.textContent  = formatNumber(Math.max(detectedLimit - tokens, 0));
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    if (charsEl) charsEl.textContent = `${text.length} chars · ${words} words`;

    if (ringEl) {
      const C = 2 * Math.PI * 35.5;
      ringEl.setAttribute("stroke-dashoffset", C * (1 - pct / 100));
      const state = pct > 80 ? "danger" : pct > 50 ? "warning" : "ok";
      const grad = state === "danger" ? "tp-grad-danger" : state === "warning" ? "tp-grad-warn" : "tp-grad";
      ringEl.setAttribute("stroke", `url(#${grad})`);
      if (box) box.setAttribute("data-state", state);
    }

    // Signals
    const signalsEl = document.getElementById("tp-signals");
    const tipEl = document.getElementById("tp-tip");
    if (signalsEl) signalsEl.innerHTML = "";
    if (tipEl) tipEl.style.display = "none";
    if (text.trim().length > 10) {
      const a = analyzePrompt(text);
      if (a && signalsEl) {
        const strengthPill = document.createElement("span");
        strengthPill.className = "tp-signal-pill";
        strengthPill.textContent = a.strength;
        strengthPill.style.color = a.strengthColor;
        strengthPill.style.borderColor = a.strengthColor + "55";
        signalsEl.appendChild(strengthPill);
        if (a.readability) {
          const r = document.createElement("span");
          r.className = "tp-signal-pill";
          r.textContent = a.readability.label;
          r.style.color = a.readability.color;
          r.style.borderColor = a.readability.color + "55";
          signalsEl.appendChild(r);
        }
        a.signals.forEach(s => {
          const p = document.createElement("span");
          p.className = "tp-signal-pill";
          p.textContent = s;
          signalsEl.appendChild(p);
        });
        if (a.readability?.tip && tipEl) {
          tipEl.textContent = "Tip: " + a.readability.tip;
          tipEl.style.display = "";
        }
      }
    }

    if (currentTab === "compare") renderCompare();
  } catch (e) { console.warn("[TokenPilot] updateTokenDisplay error:", e); }
}

// ── History render ───────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById("tp-history-list");
  const count = document.getElementById("tp-history-count");
  if (!list) return;
  const all = getHistory();
  const q = searchQuery.toLowerCase();
  const shown = q ? all.filter(h => h.text.toLowerCase().includes(q)) : all;
  if (count) count.textContent = `${all.length} saved`;
  list.innerHTML = "";

  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "tp-empty";
    empty.textContent = q ? "No prompts match" : "No history yet";
    list.appendChild(empty);
    return;
  }

  shown.forEach((h, i) => {
    const item = document.createElement("div");
    item.className = "tp-history-item";
    item.innerHTML = `
      <div class="tp-hist-body">
        <div class="tp-hist-text" title="${h.text.replace(/"/g, "&quot;")}">${escapeHtml(h.text)}</div>
        <div class="tp-hist-meta">
          <span>${h.tokens} tok</span>
          <span class="tp-dotsep"></span>
          <span>${timeAgo(h.ts || Date.now())}</span>
        </div>
      </div>
      <div class="tp-hist-actions">
        <button class="tp-iconbtn" data-act="copy" title="Copy">${svg("copy", 12)}</button>
        <button class="tp-iconbtn" data-act="restore" title="Restore">${svg("restore", 12)}</button>
        <button class="tp-iconbtn tp-danger" data-act="delete" title="Delete">${svg("trash", 12)}</button>
      </div>
    `;
    item.querySelector('[data-act="copy"]').addEventListener("click", () => {
      navigator.clipboard.writeText(h.text).then(() => toast("Copied")).catch(() => toast("Clipboard unavailable", "error"));
    });
    item.querySelector('[data-act="restore"]').addEventListener("click", () => {
      if (currentInput) { setInputText(currentInput, h.text); updateTokenDisplay(); toast("Restored"); setTab("tokens"); }
    });
    item.querySelector('[data-act="delete"]').addEventListener("click", () => {
      let raw = getHistory();
      raw = raw.filter(x => x.text !== h.text);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(raw));
      renderHistory();
    });
    list.appendChild(item);
  });
}

// ── Compare render ───────────────────────────────────────────
function renderCompare() {
  const head = document.getElementById("tp-compare-head");
  const list = document.getElementById("tp-compare-list");
  if (!list) return;
  const text = currentInput ? getInputText(currentInput) : "";
  const tokens = estimateTokens(text);
  if (head) head.textContent = `${tokens.toLocaleString()} tokens · across models`;
  list.innerHTML = "";

  const rows = [
    { key: "gpt-4o",   color: "#10a37f" },
    { key: "sonnet",   color: "#d97757" },
    { key: "gemini-2", color: "#4285f4" },
    { key: "o3",       color: "#7c3aed" },
    { key: "mistral",  color: "#ff7000" },
    { key: "deepseek", color: "#4a6cf7" },
  ];
  rows.forEach(r => {
    const m = MODEL_DB[r.key];
    if (!m) return;
    const pct = Math.min((tokens / m.limit) * 100, 100);
    const row = document.createElement("div");
    row.className = "tp-compare-row";
    row.innerHTML = `
      <div class="tp-compare-name"><span class="tp-model-dot" style="background:${r.color}"></span>${m.name}</div>
      <div class="tp-compare-bar-wrap">
        <div class="tp-compare-bar"><div class="tp-compare-bar-fill" style="width:${pct}%;background:${r.color}"></div></div>
        <div class="tp-compare-pct">${pct.toFixed(2)}%</div>
      </div>
      <div class="tp-compare-limit">${formatNumber(m.limit)}</div>
    `;
    list.appendChild(row);
  });
}

// ── Export history ───────────────────────────────────────────
function exportHistory(format) {
  const history = getHistory();
  let blob, filename;
  if (format === "json") {
    blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
    filename = "tokenpilot-history.json";
  } else {
    const rows = [["text", "tokens", "timestamp"], ...history.map(h => [`"${(h.text||"").replace(/"/g,'""')}"`, h.tokens, new Date(h.ts).toISOString()])];
    blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" });
    filename = "tokenpilot-history.csv";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${format.toUpperCase()}`);
}

// ── Toast / flash ────────────────────────────────────────────
function toast(msg, type = "success") {
  const el = document.getElementById("tp-toast");
  const textEl = document.getElementById("tp-toast-text");
  if (!el || !textEl) return;
  textEl.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
}
function flash(msg, type = "error") {
  const el = document.getElementById("tp-flash");
  if (!el) return;
  el.textContent = msg;
  el.className = `tp-flash tp-flash--${type} visible`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = "tp-flash"; }, type === "success" ? 2000 : 5000);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Input listener (unchanged logic) ─────────────────────────
function attachInputListener(el) {
  if (!el || el.dataset.tpAttached) return;
  el.dataset.tpAttached = "true";
  currentInput = el;
  const onInput = () => {
    const text = getInputText(el);
    if (!text.trim() && lastKnownPrompt.trim().length > 10) {
      saveToHistory(lastKnownPrompt);
      if (currentTab === "history") renderHistory();
      lastKnownPrompt = "";
    } else if (text.trim()) {
      lastKnownPrompt = text;
    }
    updateTokenDisplay();
  };
  el.addEventListener("input", onInput);
  el.addEventListener("keyup", onInput);
  el.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      const text = getInputText(el);
      if (text.trim().length > 10) {
        saveToHistory(text);
        if (currentTab === "history") renderHistory();
        lastKnownPrompt = "";
      }
    }
  });
  el.addEventListener("focus", () => { currentInput = el; updateTokenDisplay(); });
  updateTokenDisplay();
}

document.addEventListener("mousedown", e => {
  try {
    if (!currentInput) return;
    const btn = e.target.closest("button");
    if (!btn) return;
    const isSend = btn.querySelector("svg") || btn.ariaLabel?.toLowerCase().includes("send") ||
                   btn.innerText?.toLowerCase().includes("send") ||
                   btn.getAttribute("data-testid") === "send-button" ||
                   btn.classList.contains("send-button");
    if (isSend) {
      const text = getInputText(currentInput);
      if (text.trim().length > 10) {
        saveToHistory(text);
        if (currentTab === "history") renderHistory();
        lastKnownPrompt = "";
      }
    }
  } catch {}
});

// ── Conversation Scraper ─────────────────────────────────────
// Reads the current AI chat page DOM and returns an ordered array
// of { role: "You" | "AI", text: string, images: string[] } objects.

// ── Collect image descriptions from a message element ────────
// Returns array of human-readable descriptions instead of base64 URLs.
function collectImagesFromEl(el) {
  const imgs   = el.querySelectorAll("img");
  const result = [];
  for (const img of imgs) {
    if ((img.naturalWidth || img.width || 99) < 40) continue;
    if (img.closest("[class*='avatar'], [class*='Avatar'], [class*='logo']")) continue;
    const alt = img.alt?.trim() || "";
    let desc  = alt;
    if (!desc) {
      try {
        const src      = img.currentSrc || img.src || "";
        const filename = new URL(src, window.location.href).pathname
          .split("/").pop().replace(/[?#].*$/, "");
        if (filename) desc = filename;
      } catch {}
    }
    result.push(desc || "image");
  }
  return result; // array of description strings (no base64)
}

// ── Scroll conversation to load all virtual-rendered messages ─
async function preloadAllMessages() {
  // Find the scrollable conversation container
  let scroller = null;
  const candidates = [
    document.querySelector('[class*="overflow-y-auto"]'),
    document.querySelector('[class*="overflow-y-scroll"]'),
    document.querySelector('[class*="conversation"] [class*="overflow"]'),
    document.querySelector('[class*="messages"] [class*="overflow"]'),
    document.querySelector('main [class*="overflow"]'),
    document.querySelector('main'),
    document.documentElement,
  ];
  for (const el of candidates) {
    if (el && el.scrollHeight > el.clientHeight + 200) { scroller = el; break; }
  }
  if (!scroller) return;

  const savedTop = scroller.scrollTop;
  const step     = Math.max(scroller.clientHeight * 0.8, 500);

  // Scroll to top first
  scroller.scrollTop = 0;
  await new Promise(r => setTimeout(r, 600));

  // Scroll down step-by-step so virtualised items render
  let prev = -1;
  while (scroller.scrollTop !== prev) {
    prev = scroller.scrollTop;
    scroller.scrollTop += step;
    await new Promise(r => setTimeout(r, 250));
  }

  // Brief pause at bottom so final batch renders
  await new Promise(r => setTimeout(r, 400));

  // Restore original position
  scroller.scrollTop = savedTop;
  await new Promise(r => setTimeout(r, 150));
}

// ── Claude.ai incremental scroll-scraper ─────────────────────
// Claude removes top messages from DOM as you scroll down, so we must
// collect messages AT EACH scroll position, not after a single preload.
async function scrapeClaudeScrolling() {
  const humanSels = [
    '[data-testid="human-message"]',
    '[data-testid="user-message"]',
    '.human-turn',
    "[class*='HumanTurn']",
    "[class*='human-message']",
  ];
  const aiSels = [
    '[data-testid="assistant-message"]',
    '[data-testid*="assistant"]',
    '[data-testid="claude-message"]',
    '[data-testid*="claude-response"]',
    '.assistant-turn',
    "[class*='AssistantTurn']",
    "[class*='AssistantMessage']",
    "[class*='assistant-message']",
    "[class*='claudeMessage']",
    ".font-claude-message",
  ];

  // Walk up from a known message element to find its scrollable ancestor
  function findScroller() {
    const anchor = document.querySelector(humanSels.join(","));
    if (anchor) {
      let el = anchor.parentElement;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight + 200) {
          const s = window.getComputedStyle(el);
          if (s.overflowY === "auto" || s.overflowY === "scroll") return el;
        }
        el = el.parentElement;
      }
    }
    const main = document.querySelector("main");
    if (main && main.scrollHeight > main.clientHeight + 100) return main;
    return document.documentElement;
  }

  function collectVisible(seenKeys, messages) {
    let humanEls = [];
    for (const sel of humanSels) {
      const f = document.querySelectorAll(sel);
      if (f.length) { humanEls = Array.from(f); break; }
    }
    let aiEls = [];
    for (const sel of aiSels) {
      const f = document.querySelectorAll(sel);
      if (f.length) { aiEls = Array.from(f); break; }
    }

    let items = [];
    if (humanEls.length && aiEls.length) {
      items = [
        ...humanEls.map(el => ({ role: "You", el })),
        ...aiEls.map(el => ({ role: "AI",  el })),
      ].sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );
    } else if (humanEls.length) {
      humanEls.forEach(humanEl => {
        items.push({ role: "You", el: humanEl });
        let candidate = null;
        let node = humanEl;
        for (let lvl = 0; lvl < 3; lvl++) {
          const sib = node.nextElementSibling;
          if (sib && sib.innerText?.trim().length > 10) { candidate = sib; break; }
          if (!node.parentElement) break;
          node = node.parentElement;
        }
        if (candidate) items.push({ role: "AI", el: candidate });
      });
    }

    for (const item of items) {
      const text = (item.el.innerText || "").trim();
      if (!text) continue;
      // Use first 120 chars as dedup key (handles slight rendering diffs)
      const key = item.role + "::" + text.slice(0, 120);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      messages.push({ role: item.role, text, images: collectImagesFromEl(item.el) });
    }
  }

  const scroller  = findScroller();
  const savedTop  = scroller.scrollTop;
  const step      = Math.max(scroller.clientHeight * 0.7, 400);
  const seenKeys  = new Set();
  const messages  = [];

  // ① Scroll to very top, let first batch render
  scroller.scrollTop = 0;
  await new Promise(r => setTimeout(r, 700));
  collectVisible(seenKeys, messages);

  // ② Step down, capturing each new batch as it enters the DOM
  let prev = -1;
  while (scroller.scrollTop !== prev) {
    prev = scroller.scrollTop;
    scroller.scrollTop += step;
    await new Promise(r => setTimeout(r, 320));
    collectVisible(seenKeys, messages);
  }

  // ③ Restore user's scroll position
  scroller.scrollTop = savedTop;

  return messages.filter((m, i, arr) =>
    i === 0 || m.text !== arr[i - 1].text || m.images.length > 0
  );
}

// ── Main conversation scraper (async for image support) ──────
async function scrapeConversationAsync() {
  const host = window.location.hostname;

  // Claude.ai: use incremental scroll-collector (bidirectional virtualization)
  if (host.includes("claude.ai")) return scrapeClaudeScrolling();

  await preloadAllMessages();
  const rawItems = []; // { role, text, el }

  try {
    // ── ChatGPT ──
    if (host.includes("chatgpt") || host.includes("chat.openai")) {
      document.querySelectorAll("[data-message-author-role]").forEach(el => {
        const role = el.getAttribute("data-message-author-role");
        if (!role) return;
        // textEl = clean text (no action buttons); el = full container (captures uploaded/generated images)
        const textEl =
          (role === "user"
            ? el.querySelector(".whitespace-pre-wrap, [class*='user-message-text']")
            : el.querySelector(".markdown.prose, .markdown, [class*='prose']")
          ) || el;
        rawItems.push({ role: role === "user" ? "You" : "AI", el, textEl });
      });

    // ── Claude ──
    } else if (host.includes("claude.ai")) {

      // Try every known selector variant — Claude updates their DOM frequently
      const humanSelectors = [
        '[data-testid="human-message"]',
        '[data-testid="user-message"]',
        '.human-turn',
        "[class*='HumanTurn']",
        "[class*='human-message']",
        "[class*='UserMessage']",
      ];
      const aiSelectors = [
        '[data-testid="assistant-message"]',
        '[data-testid="ai-message"]',
        '[data-testid="claude-message"]',
        '[data-testid*="assistant"]',
        '[data-testid*="claude-response"]',
        '.assistant-turn',
        "[class*='AssistantTurn']",
        "[class*='AssistantMessage']",
        "[class*='assistant-message']",
        "[class*='claude-message']",
        "[class*='claudeMessage']",
        "[class*='AIMessage']",
        "[class*='ai-response']",
        "[class*='bot-message']",
        "[data-is-streaming]",
        ".font-claude-message",
      ];

      let humanEls = [];
      let aiEls    = [];

      for (const sel of humanSelectors) {
        const found = document.querySelectorAll(sel);
        if (found.length) { humanEls = Array.from(found); break; }
      }
      for (const sel of aiSelectors) {
        const found = document.querySelectorAll(sel);
        if (found.length) { aiEls = Array.from(found); break; }
      }

      if (humanEls.length && !aiEls.length) {
        // Selectors found humans but no AI — try nextElementSibling heuristic.
        // Claude.ai wraps [data-testid="human-message"] inside a turn container,
        // so the AI response is a sibling of the PARENT, not of the message itself.
        humanEls.forEach(humanEl => {
          rawItems.push({ role: "You", el: humanEl });
          // Walk up to 3 levels to find a sibling with substantial text
          let candidate = null;
          let node = humanEl;
          for (let lvl = 0; lvl < 3; lvl++) {
            const sib = node.nextElementSibling;
            if (sib && sib.innerText?.trim().length > 10) { candidate = sib; break; }
            if (!node.parentElement) break;
            node = node.parentElement;
          }
          if (candidate) rawItems.push({ role: "AI", el: candidate });
        });
      } else if (humanEls.length || aiEls.length) {
        humanEls.forEach(el => rawItems.push({ role: "You", el }));
        aiEls.forEach(el    => rawItems.push({ role: "AI",  el }));
        rawItems.sort((a, b) =>
          a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      } else {
        // Last resort — direct children of conversation container, alternate roles
        const container =
          document.querySelector('[class*="conversation"]') ||
          document.querySelector('[class*="Conversation"]') ||
          document.querySelector('main') ||
          document.body;
        const children = Array.from(container.children)
          .filter(el => el.innerText && el.innerText.trim().length > 10);
        let roleToggle = "You";
        children.forEach(el => {
          rawItems.push({ role: roleToggle, el });
          roleToggle = roleToggle === "You" ? "AI" : "You";
        });
      }

    // ── Gemini ──
    } else if (host.includes("gemini.google.com")) {
      // Use specific content children to avoid "You said"/"Gemini said"/"Show thinking" labels
      document.querySelectorAll("user-query").forEach(el => {
        const textEl = el.querySelector(".user-query-text-content, .query-text, p") || el;
        rawItems.push({ role: "You", el, textEl });
      });
      document.querySelectorAll("model-response").forEach(el => {
        const textEl = el.querySelector(".model-response-text, .response-content, message-content, .markdown") || el;
        rawItems.push({ role: "AI", el, textEl });
      });
      rawItems.sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

    // ── AI Studio ──
    } else if (host.includes("aistudio.google.com")) {
      document.querySelectorAll("ms-chunk").forEach(el => {
        const isUser = !!el.querySelector("[class*='user']") || el.getAttribute("role") === "user";
        rawItems.push({ role: isUser ? "You" : "AI", el });
      });

    // ── Perplexity ──
    } else if (host.includes("perplexity.ai")) {
      document.querySelectorAll('[data-testid="user-message"], .break-words').forEach(el => {
        const isUser = !!el.closest('[data-testid="user-message"]') ||
                       el.classList.contains("whitespace-pre-line");
        rawItems.push({ role: isUser ? "You" : "AI", el });
      });
      rawItems.sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

    // ── Mistral ──
    } else if (host.includes("mistral.ai") || host.includes("chat.mistral.ai")) {
      document.querySelectorAll("[class*='UserMessage'], [class*='user-message']").forEach(el =>
        rawItems.push({ role: "You", el }));
      document.querySelectorAll("[class*='AssistantMessage'], [class*='assistant-message'], [class*='BotMessage']").forEach(el =>
        rawItems.push({ role: "AI", el }));
      rawItems.sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

    // ── DeepSeek ──
    } else if (host.includes("deepseek.com")) {
      document.querySelectorAll("[class*='userMessage'], [class*='user_message'], [class*='UserMessage']").forEach(el =>
        rawItems.push({ role: "You", el }));
      document.querySelectorAll(".ds-markdown, [class*='assistantMessage'], [class*='AssistantMessage']").forEach(el =>
        rawItems.push({ role: "AI", el }));
      rawItems.sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

    // ── GitHub Copilot ──
    } else if (host.includes("github.com")) {
      document.querySelectorAll(
        '[class*="UserMessage"], [class*="user-message"], [data-testid="user-message"], [data-role="user"]'
      ).forEach(el => rawItems.push({ role: "You", el }));
      document.querySelectorAll(
        '[class*="AssistantMessage"], [class*="CopilotMessage"], [class*="assistant-message"], [data-testid="assistant-message"], [data-role="assistant"], [class*="copilot-markdown"]'
      ).forEach(el => rawItems.push({ role: "AI", el }));
      rawItems.sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

    // ── Arena.ai ──
    } else if (host.includes("arena.ai")) {
      document.querySelectorAll(
        '[class*="human"], [class*="user-message"], [class*="UserMessage"], [data-role="user"]'
      ).forEach(el => rawItems.push({ role: "You", el }));
      document.querySelectorAll(
        '[class*="assistant"], [class*="model-response"], [class*="AssistantMessage"], [data-role="assistant"]'
      ).forEach(el => rawItems.push({ role: "AI", el }));
      rawItems.sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    }

  } catch(e) {
    console.warn("[TokenPilot] scrapeConversation error:", e);
  }

  // ── Build messages with text + images ────────────────────────
  const messages = [];
  for (const item of rawItems) {
    // textEl = clean text node; el = full container (catches uploaded/generated images)
    let text = (item.textEl || item.el).innerText?.trim() || "";
    // Strip residual Gemini UI chrome
    if (host.includes("gemini.google.com")) {
      text = text.replace(/^(You said|Gemini said|Show thinking)[:\s]*/gi, "").trim();
    }
    const images = collectImagesFromEl(item.el);
    if (!text && images.length === 0) continue;
    messages.push({ role: item.role, text, images });
  }

  // De-duplicate adjacent identical text
  return messages.filter((m, i, arr) =>
    i === 0 || m.text !== arr[i - 1].text || m.images.length > 0);
}

// ── Message listener: SCRAPE_CONVERSATION (async) ────────────
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "SCRAPE_CONVERSATION") {
    scrapeConversationAsync().then(messages => {
      sendResponse({
        messages,
        platform: window.location.hostname,
        model:    detectedModel || "Unknown",
      });
    }).catch(e => {
      console.warn("[TokenPilot] scrape failed:", e);
      sendResponse({ messages: [], platform: window.location.hostname, model: "Unknown" });
    });
    return true; // keep channel open for async
  }
});

// ── Lifecycle ────────────────────────────────────────────────
function removeUI() {
  document.getElementById("tp-box")?.remove();
  aihObserver?.disconnect(); aihObserver = null;
  clearInterval(aihInterval); aihInterval = null;
  document.querySelectorAll("[data-tp-attached]").forEach(el => delete el.dataset.tpAttached);
}
function startObserver() {
  aihObserver?.disconnect();
  aihObserver = new MutationObserver(() => {
    const input = findPromptInput();
    if (input && !input.dataset.tpAttached) {
      chrome.storage.local.get(["isEnabled"], ({ isEnabled }) => {
        if (isEnabled !== false) { createUI(); attachInputListener(input); }
      });
    }
  });
  aihObserver.observe(document.body, { childList: true, subtree: true });
}
function init() {
  chrome.storage.local.get(["isEnabled"], ({ isEnabled }) => {
    if (isEnabled === false) return;
    clearInterval(aihInterval);
    let retries = 0;
    const tryAttach = () => {
      const input = findPromptInput();
      if (input) { createUI(); attachInputListener(input); startObserver(); return true; }
      return false;
    };
    if (tryAttach()) return;
    aihInterval = setInterval(() => {
      retries++;
      if (tryAttach() || retries >= 100) {
        clearInterval(aihInterval); aihInterval = null;
        if (retries >= 100) startObserver();
      }
    }, 500);
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.isEnabled) return;
  changes.isEnabled.newValue === false ? removeUI() : init();
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();