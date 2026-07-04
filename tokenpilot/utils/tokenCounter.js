// ============================================================
//  TokenPilot v3.6 — Token & Analysis Utilities
//  Pure functions — no DOM, no side effects.
// ============================================================

// Resolve tokenizer once. UMD attaches GPTTokenizer_cl100k_base to globalThis.
const __TP_TOKENIZER = (typeof globalThis !== "undefined" && globalThis.GPTTokenizer_cl100k_base) || null;

function __tp_heuristicTokens(text) {
  const words = text.trim().split(/\s+/).length;
  const specialChars = (text.match(/[^\w\s]/g) || []).length;
  return Math.ceil((words + specialChars * 0.5) * 1.3);
}

// Small LRU-ish cache. Keystroke handlers fire input+keyup per keypress on the
// same text, so repeated encode() calls are wasted work on long prompts.
let __tp_lastText = null;
let __tp_lastCount = 0;

/**
 * Real cl100k_base token count via gpt-tokenizer.
 * Falls back to heuristic if the tokenizer failed to load.
 */
function estimateTokens(text) {
  if (!text || !text.trim()) return 0;
  if (text === __tp_lastText) return __tp_lastCount;
  let count;
  try {
    if (__TP_TOKENIZER && typeof __TP_TOKENIZER.encode === "function") {
      count = __TP_TOKENIZER.encode(text).length;
    } else {
      count = __tp_heuristicTokens(text);
    }
  } catch (e) {
    console.warn("[TokenPilot] estimateTokens error:", e);
    try { count = __tp_heuristicTokens(text); } catch (_) { count = 0; }
  }
  __tp_lastText = text;
  __tp_lastCount = count;
  return count;
}

/**
 * Returns a readability rating object based on sentence/word metrics.
 */
function getReadability(text) {
  if (!text || !text.trim()) return null;
  try {
    const words = text.trim().split(/\s+/);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgWPS = sentences.length ? words.length / sentences.length : words.length;
    const longWords = words.filter(w => w.length > 8).length;
    const complexRatio = longWords / (words.length || 1);

    if (avgWPS > 25 || complexRatio > 0.35)
      return { label: "Complex", color: "#f87171", tip: "Try shorter sentences" };
    if (avgWPS > 15 || complexRatio > 0.2)
      return { label: "Moderate", color: "#fbbf24", tip: "Balanced structure" };
    return { label: "Clear", color: "#34d399", tip: "Easy to follow" };
  } catch (e) {
    console.warn("[TokenPilot] getReadability error:", e);
    return null;
  }
}

/**
 * Scores a prompt on role clarity, format hints, and context richness.
 */
function analyzePrompt(text) {
  if (!text || text.trim().length < 5) return null;
  try {
    const lower = text.toLowerCase();
    let score = 0;
    const signals = [];

    if (/(as a|act as|you are a|persona|expert|specialist)/.test(lower)) {
      score += 30; signals.push("Role defined");
    }
    if (/(bullet|table|markdown|json|format|list|paragraphs|words|characters)/.test(lower)) {
      score += 25; signals.push("Structure provided");
    }
    if (/(step by step|detailed|explain|context|background|example|sample)/.test(lower)) {
      score += 25; signals.push("Context enriched");
    }

    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount > 50) score += 20;
    else if (wordCount > 20) score += 10;

    let strength = "Basic",   strengthColor = "#94a3b8";
    if      (score >= 80) { strength = "Expert"; strengthColor = "#a855f7"; }
    else if (score >= 50) { strength = "Strong"; strengthColor = "#6366f1"; }
    else if (score >= 30) { strength = "Good";   strengthColor = "#22d3ee"; }

    return { score, strength, strengthColor, signals: signals.slice(0, 2), readability: getReadability(text) };
  } catch (e) {
    console.warn("[TokenPilot] analyzePrompt error:", e);
    return null;
  }
}
