// ============================================================
//  TokenPilot v3.2 — Model Database
//  Extracted from content.js for maintainability.
//  Add new models here without touching content logic.
// ============================================================

const MODEL_DB = {
  // OpenAI
  "gpt-4o":         { limit: 128000, name: "GPT-4o" },
  "gpt-4o-mini":    { limit: 128000, name: "GPT-4o mini" },
  "gpt-4.5":        { limit: 128000, name: "GPT-4.5" },
  "gpt-4-turbo":    { limit: 128000, name: "GPT-4 Turbo" },
  "gpt-4":          { limit: 8192,   name: "GPT-4" },
  "gpt-3.5":        { limit: 16385,  name: "GPT-3.5 Turbo" },
  "o1":             { limit: 200000, name: "o1" },
  "o1-mini":        { limit: 128000, name: "o1-mini" },
  "o3-mini":        { limit: 200000, name: "o3-mini" },
  "o3":             { limit: 200000, name: "o3" },
  // Anthropic Claude
  "opus":           { limit: 200000, name: "Claude Opus" },
  "sonnet":         { limit: 200000, name: "Claude Sonnet" },
  "haiku":          { limit: 200000, name: "Claude Haiku" },
  "claude-3":       { limit: 200000, name: "Claude 3" },
  "claude-3.5":     { limit: 200000, name: "Claude 3.5" },
  "claude-4":       { limit: 200000, name: "Claude 4" },
  // Google Gemini
  "gemini-2":       { limit: 1048576, name: "Gemini 2.0" },
  "gemini-1.5":     { limit: 1048576, name: "Gemini 1.5" },
  "gemini pro":     { limit: 1048576, name: "Gemini Pro" },
  "gemini flash":   { limit: 1048576, name: "Gemini Flash" },
  "gemini":         { limit: 1048576, name: "Gemini" },
  // Mistral
  "mistral large":  { limit: 128000, name: "Mistral Large" },
  "mistral":        { limit: 32768,  name: "Mistral" },
  // Meta Llama
  "llama-4":        { limit: 128000, name: "Llama 4" },
  "llama-3":        { limit: 8192,   name: "Llama 3" },
  "llama 3":        { limit: 8192,   name: "Llama 3" },
  // DeepSeek
  "deepseek-v3":    { limit: 128000, name: "DeepSeek V3" },
  "deepseek-r1":    { limit: 128000, name: "DeepSeek R1" },
  "deepseek":       { limit: 128000, name: "DeepSeek" },
  // Perplexity
  "sonar":          { limit: 127072, name: "Sonar" },
  // Cohere
  "command-r":      { limit: 128000, name: "Command R" },
};

const PLATFORM_DATA = {
  "chatgpt.com":       { info: "Free: ~10 msgs / 5h",      defaultModel: "gpt-4o" },
  "chat.openai.com":   { info: "Free: ~10 msgs / 5h",      defaultModel: "gpt-4o" },
  "claude.ai":         { info: "Free: Resets every 5h",    defaultModel: "sonnet" },
  "github.com":        { info: "Free: 2K inline / mo",     defaultModel: "gpt-4o" },
  "gemini.google.com": { info: "Free: Tiered Rate Limits", defaultModel: "gemini-2" },
  "aistudio.google.com":{ info: "Free: Generous Limits",   defaultModel: "gemini-1.5" },
  "arena.ai":          { info: "Arena: Context Shared",    defaultModel: "gpt-4o" },
  "perplexity.ai":     { info: "Free: 5 Pro / 4h",         defaultModel: "sonar" },
  "mistral.ai":        { info: "La Plateforme",            defaultModel: "mistral large" },
  "chat.mistral.ai":   { info: "Free tier available",      defaultModel: "mistral large" },
  "deepseek.com":      { info: "Free: DeepSeek R1",        defaultModel: "deepseek-r1" },
};

const DEFAULT_LIMIT = 128000;
