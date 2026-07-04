"use strict";

console.log("[TokenPilot] v3.5 loaded");

// ── Extension context guard (MV3 reload invalidation) ────────
// When the extension is reloaded/updated, this content script becomes
// "orphaned": chrome.runtime.id throws, sendResponse fails. These helpers
// let calls bail out cleanly instead of throwing "Extension context invalidated".
function isExtAlive() {
  try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
  catch { return false; }
}
function safeSendResponse(sendResponse, payload) {
  try { sendResponse(payload); } catch (_) { /* port closed — orphaned script */ }
}
let tpOrphaned = false;
function markOrphanedAndCleanup() {
  if (tpOrphaned) return;
  tpOrphaned = true;
  try { aihObserver?.disconnect(); } catch (_) {}
  try { clearInterval(aihInterval); } catch (_) {}
  try { document.getElementById("tp-box")?.remove(); } catch (_) {}
  try { document.getElementById("tp-fab")?.remove(); } catch (_) {}
}

// ── Constants ────────────────────────────────────────────────
const HISTORY_KEY  = "tp_prompt_history";
const THEME_KEY    = "tp_theme";
const TAB_KEY      = "tp_tab";
const CORNER_KEY   = "tp_corner";
const FAB_POS_KEY  = "tp_fab_pos";        // free-form FAB drop position {x,y}
const COLLAPSED_KEY = "tp_collapsed";
const MAX_HISTORY  = 50;
const VALID_CORNERS = ["br", "bl", "tr", "tl"];

// ── State ────────────────────────────────────────────────────
let detectedModel    = null;
let detectedPlatform = "";
let currentInput     = null;
let isCollapsed      = localStorage.getItem(COLLAPSED_KEY) === "1";
let currentCorner    = VALID_CORNERS.includes(localStorage.getItem(CORNER_KEY)) ? localStorage.getItem(CORNER_KEY) : "br";
let fabFreePos       = (function readFabPos() {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x !== "number" || typeof p?.y !== "number") return null;
    return p;
  } catch { return null; }
})();
let lastKnownPrompt  = "";
let currentTab       = (localStorage.getItem(TAB_KEY) === "compare" ? "tokens" : localStorage.getItem(TAB_KEY)) || "tokens";
let themePref        = (function readThemePref() {
  // One-time migration: old builds stored explicit "dark"/"light" as default.
  // Force auto for anyone who hasn't touched the toggle in this build.
  const MIGRATE_KEY = "tp_theme_v";
  if (localStorage.getItem(MIGRATE_KEY) !== "2") {
    localStorage.setItem(THEME_KEY, "auto");
    localStorage.setItem(MIGRATE_KEY, "2");
    return "auto";
  }
  const raw = localStorage.getItem(THEME_KEY);
  return (raw === "light" || raw === "dark" || raw === "auto") ? raw : "auto";
})();
let systemPrefersDark = (function readSystem() {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
  catch { return true; }
})();
function resolveTheme() {
  return themePref === "auto" ? (systemPrefersDark ? "dark" : "light") : themePref;
}
let currentTheme     = resolveTheme();
let searchQuery      = "";
let aihObserver      = null;
let aihInterval      = null;
let toastTimer       = null;
let lastTokenBaseline = 0;
let deltaBaselineInit = false;
let deltaResetTimer  = null;

// ── SVG icon helper ─────────────────────────────────────────
const ICONS = {
  flash:   `<path d="M13 2 3 14h7v8l10-12h-7V2z" fill="currentColor"/>`,
  minus:   `<path d="M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  plus:    `<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  sun:     `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></g>`,
  moon:    `<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  auto:    `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></g>`,
  spark:   `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.5"/></g>`,
  save:    `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></g>`,
  arrow_up:`<path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  arrow_dn:`<path d="M12 5v14M19 12l-7 7-7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  copy:    `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></g>`,
  restore: `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></g>`,
  trash:   `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></g>`,
  search:  `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>`,
  download:`<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></g>`,
  gauge:   `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3.05 11a9 9 0 1 1 0 2"/><path d="M12 14 8 10"/><circle cx="12" cy="14" r="1.5" fill="currentColor"/></g>`,
  history: `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></g>`,
  transfer: `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></g>`,
  check:   `<path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  close:   `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></g>`,
};
function svg(name, size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${ICONS[name] || ""}</svg>`;
}

// ── Theme application (auto / light / dark) ─────────────────
function applyTheme() {
  currentTheme = resolveTheme();
  const box = document.getElementById("tp-box");
  const fab = document.getElementById("tp-fab");
  const bd  = document.getElementById("tp-drag-backdrop");
  [box, fab, bd].forEach(el => {
    if (!el) return;
    el.classList.toggle("tp-light", currentTheme === "light");
  });
  const btn = document.getElementById("tp-theme-btn");
  if (btn) {
    const icon = themePref === "auto" ? "auto" : themePref === "light" ? "sun" : "moon";
    btn.innerHTML = svg(icon, 14);
    btn.title = "Theme: " + themePref + (themePref === "auto" ? " (system: " + currentTheme + ")" : "");
  }
}
try {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (e) => {
    systemPrefersDark = e.matches;
    if (themePref === "auto") applyTheme();
  };
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else if (mq.addListener) mq.addListener(handler);
} catch (_) {}

// ── Prompt dimension analysis (Clarity / Specificity / Structure) ──
function dimensionLabel(n) {
  if (n >= 5) return { text: "Excellent", color: "#a855f7" };
  if (n >= 4) return { text: "Strong",    color: "#6366f1" };
  if (n >= 3) return { text: "Good",      color: "#22d3ee" };
  if (n >= 2) return { text: "Weak",      color: "#fbbf24" };
  return       { text: "Poor",      color: "#f87171" };
}
function analyzeDimensions(text) {
  const lower = text.toLowerCase();
  const words = text.trim().split(/\s+/);
  const wc = words.length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgWPS = sentences.length ? wc / sentences.length : wc;
  const longWords = words.filter(w => w.length > 8).length;
  const complexRatio = longWords / (wc || 1);

  let clarity = 5;
  if (avgWPS > 25 || complexRatio > 0.35) clarity = 2;
  else if (avgWPS > 15 || complexRatio > 0.25) clarity = 3;
  else if (avgWPS > 10) clarity = 4;

  let spec = 0;
  if (/(as a|act as|you are|persona|expert|specialist)/.test(lower)) spec++;
  if (/(step by step|detailed|context|background|explain)/.test(lower)) spec++;
  if (/(example|sample|for instance|such as|like this)/.test(lower)) spec++;
  if (/\d/.test(text)) spec++;
  if (wc > 30) spec++;
  spec = Math.min(5, spec);

  let struct = 0;
  if (/(bullet|list|table|markdown|json|xml|format|paragraph)/.test(lower)) struct++;
  if (/^\s*(?:[-*]|\d+\.)\s/m.test(text)) struct++;
  if (/```|"""|'''|:\s*$/m.test(text)) struct++;
  if (sentences.length >= 3) struct++;
  if (/\n/.test(text)) struct++;
  struct = Math.min(5, struct);

  return {
    clarity:     { score: clarity, label: dimensionLabel(clarity) },
    specificity: { score: spec,    label: dimensionLabel(spec) },
    structure:   { score: struct,  label: dimensionLabel(struct) },
  };
}
function buildSuggestions(text, dims) {
  const lower = text.toLowerCase();
  const out = [];
  if (dims.specificity.score < 3) {
    if (!/(as a|act as|you are|persona|expert)/.test(lower))
      out.push("Assign a role (e.g. \"Act as a senior engineer\")");
    if (!/(example|sample|for instance|such as)/.test(lower))
      out.push("Add an example of desired output");
  }
  if (dims.structure.score < 3 && !/(bullet|list|table|markdown|json|format)/.test(lower)) {
    out.push("Specify output format (bullets, JSON, table)");
  }
  if (dims.clarity.score < 3) {
    out.push("Shorten long sentences for clarity");
  }
  if (!/[.?!]/.test(text) && text.trim().length > 40) {
    out.push("End with a clear question or task");
  }
  return out.slice(0, 3);
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
      // Try data-testid and class selectors first
      const selectors = [
        'button[data-testid="model-selector"]',
        '[class*="model-selector"]',
        'button[class*="ModelPicker"]',
        'button[class*="model"]',
        '[aria-label*="model" i]',
        '[class*="ModelSwitcher"]',
        '[data-testid*="model"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent.trim()) { modelText = el.textContent.trim().toLowerCase(); break; }
      }
      // Fallback: scan all buttons for known Claude model name keywords
      if (!modelText || modelText === "sonnet") {
        const knownModels = ["opus", "sonnet", "haiku"];
        const allBtns = document.querySelectorAll("button, [role='button'], span[class*='model']");
        for (const btn of allBtns) {
          const txt = (btn.textContent || "").trim().toLowerCase();
          if (txt.length < 60 && knownModels.some(m => txt.includes(m))) {
            modelText = txt;
            break;
          }
        }
      }
    } else if (host.includes("gemini")) {
      const el = document.querySelector('mat-select, [class*="model"], button[aria-label*="model"]');
      if (el) modelText = el.textContent.trim().toLowerCase();
    }
    const registry = (window.TP_REGISTRY && window.TP_REGISTRY.models) || MODEL_DB;
    for (const [key, val] of Object.entries(registry)) {
      if (modelText.includes(key)) {
        detectedModel = val.name;
        return;
      }
    }
    detectedModel = modelText || "Unknown";
  } catch (e) { console.warn("[TokenPilot] detectModel error:", e); }
}

// Re-detect when remote MODEL_DB updates (covers new model launches).
try {
  window.TP_REGISTRY?.onUpdate?.(() => {
    detectModel();
    try { updateTokenDisplay(); } catch (_) {}
  });
} catch (_) {}

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
    if (isExtAlive()) {
      try {
        chrome.runtime.sendMessage({ type: "PROMPT_SUBMITTED", tokens }).catch(() => {});
      } catch (_) { markOrphanedAndCleanup(); }
    }
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

// ── Corner positioning ──────────────────────────────────────
function applyCorner(corner) {
  if (!VALID_CORNERS.includes(corner)) corner = "br";
  currentCorner = corner;
  localStorage.setItem(CORNER_KEY, corner);
  const box = document.getElementById("tp-box");
  const fab = document.getElementById("tp-fab");
  [box, fab].forEach(el => {
    if (!el) return;
    // FAB owns a free-form drop position when set — don't override with corner.
    if (el === fab && fabFreePos) return;
    el.classList.remove("tp-corner-br", "tp-corner-bl", "tp-corner-tr", "tp-corner-tl");
    el.classList.add(`tp-corner-${corner}`);
  });
}

function nearestCorner(x, y) {
  const w = window.innerWidth, h = window.innerHeight;
  const isLeft = x < w / 2;
  const isTop  = y < h / 2;
  return (isTop ? "t" : "b") + (isLeft ? "l" : "r");
}

// ── Drag backdrop (blurred overlay shown while user repositions FAB) ──
function showDragBackdrop() {
  let bd = document.getElementById("tp-drag-backdrop");
  if (!bd) {
    bd = document.createElement("div");
    bd.id = "tp-drag-backdrop";
    if (resolveTheme() === "light") bd.classList.add("tp-light");
    document.body.appendChild(bd);
    // next frame → trigger fade-in
    requestAnimationFrame(() => bd.classList.add("is-visible"));
  } else {
    bd.classList.add("is-visible");
  }
}
function hideDragBackdrop() {
  const bd = document.getElementById("tp-drag-backdrop");
  if (!bd) return;
  bd.classList.remove("is-visible");
  setTimeout(() => bd.remove(), 220); // match CSS transition
}

// Apply a saved free position to FAB (clamped to viewport).
function applyFabFreePos(fab, pos) {
  if (!fab || !pos) return;
  const w = fab.offsetWidth || 44, h = fab.offsetHeight || 44;
  const x = Math.max(8, Math.min(window.innerWidth  - w - 8, pos.x));
  const y = Math.max(8, Math.min(window.innerHeight - h - 8, pos.y));
  fab.classList.remove("tp-corner-br", "tp-corner-bl", "tp-corner-tr", "tp-corner-tl");
  fab.style.left   = x + "px";
  fab.style.top    = y + "px";
  fab.style.right  = "auto";
  fab.style.bottom = "auto";
}

// Keep FAB inside viewport when the window is resized.
window.addEventListener("resize", () => {
  if (!fabFreePos) return;
  const fab = document.getElementById("tp-fab");
  if (fab) applyFabFreePos(fab, fabFreePos);
});

function setCollapsed(collapsed) {
  isCollapsed = collapsed;
  localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  const box = document.getElementById("tp-box");
  const fab = document.getElementById("tp-fab");
  // When expanding, anchor box to the corner nearest the FAB so it opens
  // on the same side the user dragged the FAB to.
  if (!collapsed && fab && fabFreePos) {
    const r = fab.getBoundingClientRect();
    const corner = nearestCorner(r.left + r.width / 2, r.top + r.height / 2);
    applyCorner(corner);
  }
  if (box) box.style.display = collapsed ? "none" : "";
  if (fab) fab.style.display = collapsed ? "inline-flex" : "none";
}

// ── Build FAB (collapsed-state floating icon) ───────────────
function createFAB() {
  if (document.getElementById("tp-fab")) return;
  const fab = document.createElement("button");
  fab.id = "tp-fab";
  fab.type = "button";
  fab.title = "TokenPilot — click to open, drag to move";
  fab.innerHTML = `<span class="tp-fab-icon">${svg("flash", 18)}</span>`;
  if (resolveTheme() === "light") fab.classList.add("tp-light");
  document.body.appendChild(fab);
  // Restore saved free-form drop position (overrides corner anchor).
  if (fabFreePos) applyFabFreePos(fab, fabFreePos);
  attachFabDrag(fab);

  fab.addEventListener("click", () => {
    if (fab.dataset.dragged === "1") { fab.dataset.dragged = "0"; return; }
    setCollapsed(false);
  });
}

function attachFabDrag(fab) {
  let startX = 0, startY = 0, originX = 0, originY = 0;
  let dragging = false, moved = false;
  let pointerId = null;

  const onDown = e => {
    if (e.button !== undefined && e.button !== 0) return;
    pointerId = e.pointerId;
    dragging = true;
    moved = false;
    const r = fab.getBoundingClientRect();
    originX = r.left;
    originY = r.top;
    startX = e.clientX;
    startY = e.clientY;
    fab.setPointerCapture?.(pointerId);
    fab.classList.add("is-dragging");
    fab.style.transition = "none";
    // Backdrop appears only once the pointer actually moves (see onMove).
  };

  const onMove = e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) > 4) {
      moved = true;
      showDragBackdrop();
    }
    if (!moved) return;
    const w = fab.offsetWidth, h = fab.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth  - w - 8, originX + dx));
    const y = Math.max(8, Math.min(window.innerHeight - h - 8, originY + dy));
    fab.classList.remove("tp-corner-br", "tp-corner-bl", "tp-corner-tr", "tp-corner-tl");
    fab.style.left = x + "px";
    fab.style.top  = y + "px";
    fab.style.right = "auto";
    fab.style.bottom = "auto";
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    fab.releasePointerCapture?.(pointerId);
    fab.classList.remove("is-dragging");
    fab.style.transition = "";
    if (moved) {
      fab.dataset.dragged = "1";
      hideDragBackdrop();
      // Free-form drop: keep FAB exactly where released, save position.
      const r = fab.getBoundingClientRect();
      const pos = { x: r.left, y: r.top };
      fabFreePos = pos;
      try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos)); } catch (_) {}
    }
  };

  fab.addEventListener("pointerdown", onDown);
  fab.addEventListener("pointermove", onMove);
  fab.addEventListener("pointerup", onUp);
  fab.addEventListener("pointercancel", onUp);
}

// ── Build UI ─────────────────────────────────────────────────
function createUI() {
  if (document.getElementById("tp-box")) return;
  createFAB();
  const box = document.createElement("div");
  box.id = "tp-box";
  if (resolveTheme() === "light") box.classList.add("tp-light");

  box.innerHTML = `
    <div class="tp-header">
      <div class="tp-brand">
        <div class="tp-logo">${svg("flash", 14)}</div>
        <div class="tp-brand-text">
          <div class="tp-brand-name">TokenPilot</div>
          <div class="tp-brand-host"><span class="tp-live-dot"></span><span id="tp-host-label">${window.location.hostname}</span><span class="tp-brand-ver">· v${(chrome.runtime?.getManifest?.().version) || ""}</span></div>
        </div>
      </div>
      <div class="tp-header-actions">
        <button class="tp-iconbtn" id="tp-theme-btn" title="Toggle theme">${svg(themePref === "auto" ? "auto" : themePref === "light" ? "sun" : "moon", 14)}</button>
        <button class="tp-iconbtn" id="tp-collapse-btn" title="Collapse">${svg("minus", 14)}</button>
      </div>
    </div>


    <div class="tp-tabs" id="tp-tabs">
      <div class="tp-tabs-indicator" id="tp-tabs-indicator"></div>
      <button class="tp-tab" data-tab="tokens">${svg("gauge", 13)}<span>Live</span></button>
      <button class="tp-tab" data-tab="history">${svg("history", 13)}<span>History</span></button>
      <button class="tp-tab" data-tab="transfer">${svg("transfer", 13)}<span>Transfer</span></button>
    </div>

    <div class="tp-tabbody">
      <div class="tp-pane tp-live" data-pane="tokens">
        <div class="tp-hero">
          <div class="tp-hero-row">
            <span class="tp-hero-num" id="tp-token-num">0</span>
            <span class="tp-hero-unit">tokens</span>
            <span class="tp-delta" id="tp-delta"></span>
          </div>
          <div class="tp-hero-sub" id="tp-hero-sub">
            <span id="tp-words">0 words</span>
            <span class="tp-hero-sep">·</span>
            <span id="tp-chars">0 chars</span>
          </div>
        </div>

        <div class="tp-section" id="tp-analysis-section" style="display:none">
          <div class="tp-section-label">Prompt Analysis</div>
          <div class="tp-dim-list" id="tp-dim-list"></div>
        </div>

        <div class="tp-section" id="tp-suggest-section" style="display:none">
          <div class="tp-section-label">${svg("spark", 10)}<span>Suggestions</span></div>
          <div class="tp-suggest-list" id="tp-suggest-list"></div>
        </div>

        <div class="tp-live-empty" id="tp-live-empty">Start typing to see live analysis</div>

        <div class="tp-live-actions">
          <button class="tp-action-btn" id="tp-copy-prompt">${svg("copy", 12)}<span>Copy</span></button>
          <button class="tp-action-btn" id="tp-save-prompt">${svg("save", 12)}<span>Save</span></button>
        </div>
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

      <div class="tp-pane tp-transfer" data-pane="transfer" style="display:none">
        <div class="tp-transfer-desc">Export this conversation as Markdown and open it in another AI.</div>
        <button class="tp-transfer-btn" id="tp-transfer-btn">
          ${svg("transfer", 14)}
          Transfer Chat to Another AI
        </button>
        <div class="tp-send-row">
          <select class="tp-target-select" id="tp-target-select" aria-label="Target AI">
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="aistudio">AI Studio</option>
            <option value="perplexity">Perplexity</option>
            <option value="mistral">Mistral</option>
            <option value="deepseek">DeepSeek</option>
          </select>
          <button class="tp-send-btn" id="tp-send-btn" title="Open target AI in a new tab and auto-paste the conversation">
            ${svg("transfer", 13)}
            Send
          </button>
        </div>
        <div class="tp-transfer-status" id="tp-transfer-status"></div>
      </div>
    </div>

    <div class="tp-toast" id="tp-toast">${svg("check", 12)}<span id="tp-toast-text">Done</span></div>
  `;

  document.body.appendChild(box);
  bindUIEvents();
  applyCorner(currentCorner);
  applyTheme();
  setCollapsed(isCollapsed);
  detectModel();
  setTab(currentTab, true);
  refreshAll();
  setInterval(() => { detectModel(); refreshAll(); }, 5000);
}

// ── Event bindings ──────────────────────────────────────────
function bindUIEvents() {
  const $ = id => document.getElementById(id);

  $("tp-theme-btn").addEventListener("click", () => {
    themePref = themePref === "auto" ? "light" : themePref === "light" ? "dark" : "auto";
    localStorage.setItem(THEME_KEY, themePref);
    applyTheme();
    toast("Theme: " + themePref);
  });

  $("tp-copy-prompt").addEventListener("click", () => {
    const text = currentInput ? getInputText(currentInput) : "";
    if (!text.trim()) { toast("Nothing to copy"); return; }
    navigator.clipboard.writeText(text).then(() => toast("Copied")).catch(() => toast("Clipboard unavailable"));
  });
  $("tp-save-prompt").addEventListener("click", () => {
    const text = currentInput ? getInputText(currentInput) : "";
    if (!text.trim() || text.trim().length < 10) { toast("Nothing to save"); return; }
    saveToHistory(text);
    if (currentTab === "history") renderHistory();
    toast("Saved");
  });

  $("tp-collapse-btn").addEventListener("click", () => setCollapsed(true));

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
  $("tp-transfer-btn").addEventListener("click", transferChat);
  const sendBtn = $("tp-send-btn");
  if (sendBtn) sendBtn.addEventListener("click", sendChatToTarget);
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
}

// ── Refresh all dynamic bits ─────────────────────────────────
function refreshAll() {
  updateTokenDisplay();
}

// ── Live display (hero count + delta + analysis dims + suggestions) ──
function updateTokenDisplay() {
  try {
    const text = currentInput ? getInputText(currentInput) : "";
    const trimmed = text.trim();
    const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
    const tokens = estimateTokens(text);

    const numEl    = document.getElementById("tp-token-num");
    const wordsEl  = document.getElementById("tp-words");
    const charsEl  = document.getElementById("tp-chars");
    const deltaEl  = document.getElementById("tp-delta");
    const emptyEl  = document.getElementById("tp-live-empty");
    const anaSec   = document.getElementById("tp-analysis-section");
    const dimList  = document.getElementById("tp-dim-list");
    const sugSec   = document.getElementById("tp-suggest-section");
    const sugList  = document.getElementById("tp-suggest-list");

    if (numEl)   numEl.textContent   = tokens.toLocaleString();
    if (wordsEl) wordsEl.textContent = wordCount + (wordCount === 1 ? " word" : " words");
    if (charsEl) charsEl.textContent = text.length.toLocaleString() + " chars";

    // Delta chip: diff vs. last idle baseline. Auto-resets after user pauses.
    if (deltaEl) {
      if (!deltaBaselineInit) {
        lastTokenBaseline = tokens;
        deltaBaselineInit = true;
      }
      const diff = tokens - lastTokenBaseline;
      if (diff === 0 || !trimmed) {
        deltaEl.classList.remove("is-visible", "is-up", "is-down");
        deltaEl.innerHTML = "";
      } else {
        deltaEl.classList.add("is-visible");
        deltaEl.classList.toggle("is-up",   diff > 0);
        deltaEl.classList.toggle("is-down", diff < 0);
        const glyph = diff > 0 ? svg("arrow_up", 9) : svg("arrow_dn", 9);
        deltaEl.innerHTML = glyph + "<span>" + (diff > 0 ? "+" : "") + diff + "</span>";
      }
      clearTimeout(deltaResetTimer);
      deltaResetTimer = setTimeout(() => {
        lastTokenBaseline = tokens;
        if (deltaEl) {
          deltaEl.classList.remove("is-visible", "is-up", "is-down");
          deltaEl.innerHTML = "";
        }
      }, 1600);
    }

    // Analysis + suggestions only when there's meaningful text.
    const hasContent = trimmed.length >= 10;
    if (emptyEl) emptyEl.style.display = hasContent ? "none" : "";

    if (hasContent) {
      const dims = analyzeDimensions(text);
      if (dimList && anaSec) {
        dimList.innerHTML = "";
        const rows = [
          ["Clarity",     dims.clarity],
          ["Specificity", dims.specificity],
          ["Structure",   dims.structure],
        ];
        rows.forEach(([name, d]) => {
          const row = document.createElement("div");
          row.className = "tp-dim-row";
          let dots = "";
          for (let i = 1; i <= 5; i++) {
            dots += `<span class="tp-dot${i <= d.score ? " is-on" : ""}" style="${i <= d.score ? "background:" + d.label.color : ""}"></span>`;
          }
          row.innerHTML = `
            <span class="tp-dim-name">${name}</span>
            <span class="tp-dim-dots">${dots}</span>
            <span class="tp-dim-label" style="color:${d.label.color}">${d.label.text}</span>`;
          dimList.appendChild(row);
        });
        anaSec.style.display = "";
      }

      const tips = buildSuggestions(text, dims);
      if (sugList && sugSec) {
        sugList.innerHTML = "";
        if (tips.length) {
          tips.forEach(t => {
            const row = document.createElement("div");
            row.className = "tp-suggest-item";
            row.innerHTML = `<span class="tp-suggest-arrow">→</span><span>${escapeHtml(t)}</span>`;
            sugList.appendChild(row);
          });
          sugSec.style.display = "";
        } else {
          sugSec.style.display = "none";
        }
      }
    } else {
      if (anaSec) anaSec.style.display = "none";
      if (sugSec) sugSec.style.display = "none";
    }
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

  shown.forEach((h) => {
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

// ── YAML scalar escape (quoted, double-quote + backslash safe) ──
function tpYamlEscape(v) {
  const s = String(v == null ? "" : v);
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// ── Human-readable filename timestamp: 2026-06-20-1542 ───────
function tpFmtFilenameStamp(d) {
  d = d || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
         "-" + pad(d.getHours()) + pad(d.getMinutes());
}

// Remove consecutive duplicate lines (and consecutive duplicate paragraphs).
// Claude renders some tool-use blocks as summary + expanded twin nodes; innerText
// collapses both into the same string, producing "X\nX" pairs.
function dedupeConsecutiveLines(text) {
  if (!text) return text;
  const lines = text.split("\n");
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && out.length && out[out.length - 1].trim() === trimmed) continue;
    out.push(line);
  }
  // Also drop consecutive duplicate blocks separated by blank lines (e.g. "A\n\nA").
  const blocks = out.join("\n").split(/\n{2,}/);
  const dedupedBlocks = [];
  for (const b of blocks) {
    const t = b.trim();
    if (t && dedupedBlocks.length && dedupedBlocks[dedupedBlocks.length - 1].trim() === t) continue;
    dedupedBlocks.push(b);
  }
  return dedupedBlocks.join("\n\n");
}

// ── Transfer payload builder (shared by download + send-to-AI) ──
function buildTransferMarkdown(messages) {
  const host    = detectedPlatform || window.location.hostname;
  const aiName  = detectedModel || "AI";
  const date    = new Date().toLocaleString();
  const isoDate = new Date().toISOString();
  const safeName = host.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 30);

  const frontmatter =
    "---\n" +
    "title: " + tpYamlEscape("TokenPilot Chat Transfer") + "\n" +
    "platform: " + tpYamlEscape(host) + "\n" +
    "model: " + tpYamlEscape(aiName) + "\n" +
    "exported: " + tpYamlEscape(isoDate) + "\n" +
    "exported_human: " + tpYamlEscape(date) + "\n" +
    "messages: " + messages.length + "\n" +
    "---\n\n";

  const instructions =
    "> **Instructions for the receiving AI**\n" +
    "> This conversation was originally held with **" + aiName + "** on `" + host + "`.\n" +
    "> Read every message carefully, absorb all context, then continue as the AI assistant.\n" +
    "> Start your reply with a one-line recap of what was discussed.\n\n---\n\n## Conversation Transcript\n\n";

  let body = "";
  messages.forEach((m, i) => {
    const n       = i + 1;
    const heading = m.role === "You"
      ? "### " + n + ". You"
      : "### " + n + ". Assistant (" + aiName + ")";
    body += (i > 0 ? "\n<hr class=\"tp-msg-break\"/>\n\n" : "") + heading + "\n\n";
    if (m.text) {
      // Escape leading "---" lines to prevent MD horizontal-rule / YAML
      // collision inside the transcript.
      const cleaned = dedupeConsecutiveLines(m.text).replace(/^---(?=\s|$)/gm, "\\---");
      body += cleaned + "\n\n";
    }
    if (m.images && m.images.length > 0) {
      m.images.forEach(desc => {
        const prefix = m.role === "You" ? "User uploaded" : "AI generated image";
        body += "[" + prefix + ": " + desc + "]\n\n";
      });
    }
  });

  const footer = "\n---\n\n## ▶ Continue from here\n\n_Paste your next message below after uploading this file to a new chat._\n";
  return { content: frontmatter + instructions + body + footer, host, safeName, aiName };
}

// ── Target AI registry (mirror of popup.js TARGETS) ──────────
const TP_TARGETS = {
  chatgpt:    { name: "ChatGPT",    url: "https://chatgpt.com/" },
  claude:     { name: "Claude",     url: "https://claude.ai/new" },
  gemini:     { name: "Gemini",     url: "https://gemini.google.com/app" },
  aistudio:   { name: "AI Studio",  url: "https://aistudio.google.com/prompts/new_chat" },
  perplexity: { name: "Perplexity", url: "https://www.perplexity.ai/" },
  mistral:    { name: "Mistral",    url: "https://chat.mistral.ai/chat" },
  deepseek:   { name: "DeepSeek",   url: "https://chat.deepseek.com/" }
};

// ── Transfer chat (download .md) ─────────────────────────────
function transferChat() {
  const btn = document.getElementById("tp-transfer-btn");
  const statusEl = document.getElementById("tp-transfer-status");
  const setMsg = (msg, cls) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "tp-transfer-status" + (cls ? " " + cls : "");
  };

  if (btn) btn.disabled = true;
  setMsg("Capturing conversation…");

  scrapeConversationAsync().then(messages => {
    if (btn) btn.disabled = false;
    if (!messages || messages.length === 0) {
      setMsg("No conversation found on this page.", "err");
      return;
    }

    const { content, safeName } = buildTransferMarkdown(messages);

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tokenpilot-transfer-" + safeName + "-" + tpFmtFilenameStamp() + ".md";
    a.click();
    URL.revokeObjectURL(url);

    setMsg("✓ " + messages.length + " msgs exported!", "ok");
    setTimeout(() => setMsg(""), 5000);
  }).catch(e => {
    if (btn) btn.disabled = false;
    console.warn("[TokenPilot] transferChat error:", e);
    setMsg("Export failed. Try reloading the page.", "err");
  });
}

// ── Send chat to another AI (auto-paste into new tab) ────────
function sendChatToTarget() {
  const btn       = document.getElementById("tp-send-btn");
  const selectEl  = document.getElementById("tp-target-select");
  const statusEl  = document.getElementById("tp-transfer-status");
  const targetKey = selectEl ? selectEl.value : "chatgpt";
  const target    = TP_TARGETS[targetKey];

  const setMsg = (msg, cls) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "tp-transfer-status" + (cls ? " " + cls : "");
  };

  if (!target) { setMsg("Unknown target.", "err"); return; }

  if (btn) btn.disabled = true;
  setMsg("Capturing conversation…");

  scrapeConversationAsync().then(messages => {
    if (!messages || messages.length === 0) {
      if (btn) btn.disabled = false;
      setMsg("No conversation found on this page.", "err");
      return;
    }

    const { content } = buildTransferMarkdown(messages);

    const payload = {
      target:     targetKey,
      content:    content,
      autoSubmit: false,
      createdAt:  Date.now()
    };

    setMsg("Opening " + target.name + "…");

    if (!isExtAlive()) {
      if (btn) btn.disabled = false;
      setMsg("Extension reloaded — refresh this page and try again.", "err");
      markOrphanedAndCleanup();
      return;
    }
    try {
      chrome.storage.local.set({ tp_pending_paste: payload }, () => {
        if (chrome.runtime.lastError) {
          if (btn) btn.disabled = false;
          setMsg("Failed to stage payload.", "err");
          return;
        }
        // Service worker opens the tab — content scripts can't call chrome.tabs.create.
        try {
          chrome.runtime.sendMessage(
            { type: "OPEN_TARGET_TAB", url: target.url },
            (res) => {
              if (btn) btn.disabled = false;
              if (chrome.runtime.lastError || !res || !res.ok) {
                setMsg("Couldn't open new tab. Check extension permissions.", "err");
                return;
              }
              setMsg("✓ " + messages.length + " msgs · sent to " + target.name, "ok");
              setTimeout(() => setMsg(""), 6000);
            }
          );
        } catch (_) {
          if (btn) btn.disabled = false;
          setMsg("Extension reloaded — refresh this page and try again.", "err");
          markOrphanedAndCleanup();
        }
      });
    } catch (_) {
      if (btn) btn.disabled = false;
      setMsg("Extension reloaded — refresh this page and try again.", "err");
      markOrphanedAndCleanup();
    }
  }).catch(e => {
    if (btn) btn.disabled = false;
    console.warn("[TokenPilot] sendChatToTarget error:", e);
    setMsg("Send failed. Try reloading the page.", "err");
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
function toast(msg) {
  const el = document.getElementById("tp-toast");
  const textEl = document.getElementById("tp-toast-text");
  if (!el || !textEl) return;
  textEl.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
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
// Returns array of human-readable descriptions (deduped by src) instead of base64 URLs.
function collectImagesFromEl(el) {
  const imgs   = el.querySelectorAll("img");
  const result = [];
  const seen   = new Set();
  for (const img of imgs) {
    if ((img.naturalWidth || img.width || 99) < 40) continue;
    if (img.closest("[class*='avatar'], [class*='Avatar'], [class*='logo']")) continue;
    const src = img.currentSrc || img.src || "";
    const alt = img.alt?.trim() || "";
    let desc  = alt;
    if (!desc) {
      try {
        const filename = new URL(src, window.location.href).pathname
          .split("/").pop().replace(/[?#].*$/, "");
        if (filename) desc = filename;
      } catch {}
    }
    desc = desc || "image";
    // Dedupe by src when available (thumbnail + full-size share src in many UIs),
    // otherwise fall back to desc.
    const sig = src || desc;
    if (seen.has(sig)) continue;
    seen.add(sig);
    result.push(desc);
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
    // ── APPROACH 1: data-testid selectors ────────────────────────
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
      // Best case: both selectors found elements
      items = [
        ...humanEls.map(el => ({ role: "You", el })),
        ...aiEls.map(el => ({ role: "AI",  el })),
      ].sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );

    } else {
      // ── APPROACH 2: Feedback-button detection ─────────────────
      // KEY INSIGHT: Claude's AI responses always have thumbs-up/down feedback
      // buttons. Human messages NEVER have them. This is DOM-change-proof.
      const seenContainers = new WeakSet();

      // Find all copy buttons (present on EVERY message in Claude)
      const copyBtns = Array.from(document.querySelectorAll(
        'button[aria-label*="opy" i], button[title*="opy" i]'
      )).filter(btn => {
        // Exclude copy buttons inside code blocks (they have different parents)
        const pre = btn.closest("pre, code, [class*='code']");
        return !pre;
      });

      for (const copyBtn of copyBtns) {
        // Walk up from copy button to find the message container
        let el = copyBtn.parentElement;
        let msgContainer = null;

        for (let i = 0; i < 12; i++) {
          if (!el || el === document.body) break;
          const text = el.innerText?.trim();
          // Message containers have substantial text and reasonable dimensions
          if (text && text.length > 20) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 150) {
              msgContainer = el;
              break;
            }
          }
          el = el.parentElement;
        }

        if (!msgContainer || seenContainers.has(msgContainer)) continue;
        seenContainers.add(msgContainer);

        // AI messages: have thumbs-up / thumbs-down / feedback buttons
        // Human messages: NEVER have these buttons
        const hasFeedback = !!msgContainer.querySelector(
          'button[aria-label*="humb" i], ' +
          'button[aria-label*="Good response" i], ' +
          'button[aria-label*="Bad response" i], ' +
          'button[aria-label*="Like" i], ' +
          'button[aria-label*="Dislike" i], ' +
          'button[aria-label*="eedback" i], ' +
          'button[data-testid*="feedback" i], ' +
          'button[data-testid*="thumb" i]'
        );

        items.push({ role: hasFeedback ? "AI" : "You", el: msgContainer });
      }

      // Sort by DOM order
      items.sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );

      // ── APPROACH 3: Alternation fallback ──────────────────────
      // If feedback detection found nothing, use human els + sibling walk
      if (items.length === 0 && humanEls.length > 0) {
        humanEls.forEach(humanEl => {
          items.push({ role: "You", el: humanEl });
          // Find AI response: walk to next sibling containers
          let node = humanEl;
          for (let lvl = 0; lvl < 6; lvl++) {
            const sib = node.nextElementSibling;
            if (sib) {
              const sibText = sib.innerText?.trim();
              if (sibText && sibText.length > 20) {
                items.push({ role: "AI", el: sib });
                break;
              }
            }
            if (!node.parentElement) break;
            node = node.parentElement;
          }
        });
      }
    }

    // ── Collect text + images from each item ─────────────────────
    for (const item of items) {
      const text = (item.el.innerText || "").trim();
      if (!text) continue;
      const key = item.role + "::" + text.slice(0, 120);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      messages.push({ role: item.role, text, images: collectImagesFromEl(item.el) });
    }
  }

  const seenKeys  = new Set();
  const messages  = [];

  const scroller  = findScroller();
  const savedTop  = scroller.scrollTop;
  const step      = Math.max(scroller.clientHeight * 0.7, 400);

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

  return dropWrapperMessages(messages.filter((m, i, arr) =>
    i === 0 || m.text !== arr[i - 1].text || m.images.length > 0
  ));
}

// Drop wrapper messages: when a captured element's text fully contains the text
// of two or more other captured messages, it's a parent container that wrapped
// multiple messages. Keep the granular children, drop the wrapper.
function dropWrapperMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return messages;
  const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
  const items = messages.map((m) => ({ msg: m, norm: norm(m.text) })).filter((x) => x.norm.length > 0);
  const drop = new Set();
  for (let i = 0; i < items.length; i++) {
    let containedCount = 0;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (items[i].norm.length <= items[j].norm.length) continue;
      // Require child to be substantial (>= 40 chars) and fully contained.
      if (items[j].norm.length >= 40 && items[i].norm.includes(items[j].norm)) {
        containedCount++;
        if (containedCount >= 2) break;
      }
    }
    if (containedCount >= 2) drop.add(i);
  }
  if (!drop.size) return messages;
  return items.filter((_, i) => !drop.has(i)).map((x) => x.msg);
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

  // De-duplicate adjacent identical text + drop wrapper-of-wrappers
  return dropWrapperMessages(messages.filter((m, i, arr) =>
    i === 0 || m.text !== arr[i - 1].text || m.images.length > 0));
}

// ── Message listener: SCRAPE_CONVERSATION (async) ────────────
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!isExtAlive()) { markOrphanedAndCleanup(); return; }
  if (request.type === "SCRAPE_CONVERSATION") {
    scrapeConversationAsync().then(messages => {
      safeSendResponse(sendResponse, {
        messages,
        platform: window.location.hostname,
        model:    detectedModel || "Unknown",
      });
    }).catch(e => {
      console.warn("[TokenPilot] scrape failed:", e);
      safeSendResponse(sendResponse, { messages: [], platform: window.location.hostname, model: "Unknown" });
    });
    return true; // keep channel open for async
  }
});

// ── Lifecycle ────────────────────────────────────────────────
function removeUI() {
  document.getElementById("tp-box")?.remove();
  document.getElementById("tp-fab")?.remove();
  aihObserver?.disconnect(); aihObserver = null;
  clearInterval(aihInterval); aihInterval = null;
  document.querySelectorAll("[data-tp-attached]").forEach(el => delete el.dataset.tpAttached);
}
function startObserver() {
  aihObserver?.disconnect();
  aihObserver = new MutationObserver(() => {
    if (!isExtAlive()) { markOrphanedAndCleanup(); return; }
    const input = findPromptInput();
    if (input && !input.dataset.tpAttached) {
      try {
        chrome.storage.local.get(["isEnabled"], ({ isEnabled }) => {
          if (chrome.runtime.lastError) return;
          if (isEnabled !== false) {
            // UI may already exist (created in init); ensure it's there before binding input.
            if (!document.getElementById("tp-box")) createUI();
            attachInputListener(input);
          }
        });
      } catch (_) { markOrphanedAndCleanup(); }
    }
  });
  aihObserver.observe(document.body, { childList: true, subtree: true });
}
function init() {
  if (!isExtAlive()) { markOrphanedAndCleanup(); return; }
  try {
    chrome.storage.local.get(["isEnabled"], ({ isEnabled }) => {
      if (chrome.runtime.lastError) return;
      if (isEnabled === false) return;
      initInner();
    });
  } catch (_) { markOrphanedAndCleanup(); }
}
function initInner() {
    // Show the FAB + panel immediately — don't wait for a prompt input.
    // Input attachment (for token counting) happens separately below.
    if (!document.getElementById("tp-box")) createUI();
    // Start the observer first so any later input attaches automatically.
    startObserver();
    // Best-effort: try to attach to an input right now; if not present yet,
    // a short poll covers SPA hydration, after which the observer handles the rest.
    clearInterval(aihInterval);
    let retries = 0;
    const tryAttach = () => {
      const input = findPromptInput();
      if (input && !input.dataset.tpAttached) { attachInputListener(input); return true; }
      return !!(input && input.dataset.tpAttached);
    };
    if (tryAttach()) return;
    aihInterval = setInterval(() => {
      retries++;
      if (tryAttach() || retries >= 60) {
        clearInterval(aihInterval); aihInterval = null;
      }
    }, 500);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (!isExtAlive()) { markOrphanedAndCleanup(); return; }
  if (area !== "local" || !changes.isEnabled) return;
  changes.isEnabled.newValue === false ? removeUI() : init();
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

// ── SPA navigation watcher ───────────────────────────────────
// ChatGPT/Claude/Gemini are SPAs: clicking a sidebar chat or "new chat" only
// changes location.href via pushState/replaceState. The content script does NOT
// re-execute. Without this watcher the FAB silently vanishes until full reload.
(function watchSpaNav() {
  let lastHref = location.href;

  function onRouteChange() {
    if (!isExtAlive()) { markOrphanedAndCleanup(); return; }
    if (location.href === lastHref) return;
    lastHref = location.href;
    setTimeout(() => {
      try {
        if (!document.getElementById("tp-box")) init();
        else detectModel();
      } catch (e) { console.warn("[TokenPilot] SPA re-init failed:", e); }
    }, 350);
  }

  ["pushState", "replaceState"].forEach((m) => {
    const orig = history[m];
    if (orig && !orig.__tpPatched) {
      const wrapped = function () {
        const ret = orig.apply(this, arguments);
        window.dispatchEvent(new Event("tp:locationchange"));
        return ret;
      };
      wrapped.__tpPatched = true;
      history[m] = wrapped;
    }
  });
  window.addEventListener("popstate", onRouteChange);
  window.addEventListener("tp:locationchange", onRouteChange);

  // Heartbeat: rebuild UI if Claude/ChatGPT tore down our subtree.
  setInterval(() => {
    if (!isExtAlive()) { markOrphanedAndCleanup(); return; }
    if (tpOrphaned) return;
    if (!document.getElementById("tp-box") && !document.getElementById("tp-fab")) {
      try { init(); } catch (_) {}
    }
  }, 3000);
})();