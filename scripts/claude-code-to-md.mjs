#!/usr/bin/env node
/**
 * claude-code-to-md — Convert a Claude Code CLI session JSONL to clean
 * markdown suitable for pasting into another AI web UI.
 *
 * Usage:
 *   node scripts/claude-code-to-md.mjs                 # latest session for cwd
 *   node scripts/claude-code-to-md.mjs --list          # list available sessions
 *   node scripts/claude-code-to-md.mjs <session.jsonl> # explicit file
 *   node scripts/claude-code-to-md.mjs --project /path/to/repo
 *   node scripts/claude-code-to-md.mjs --include-tools # keep tool_use + tool_result
 *   node scripts/claude-code-to-md.mjs --include-thinking # keep thinking blocks
 *
 * Output on stdout: plain markdown transcript. Pipe to tp-relay.sh to send it
 * to the Chrome extension via the clipboard.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { argv, cwd, exit, stdout, stderr } from "node:process";

const CLAUDE_ROOT = join(homedir(), ".claude", "projects");

const args = argv.slice(2);
const opts = {
  list: false,
  includeTools: false,
  includeThinking: false,
  project: null,
  file: null
};

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--list") opts.list = true;
  else if (a === "--include-tools") opts.includeTools = true;
  else if (a === "--include-thinking") opts.includeThinking = true;
  else if (a === "--project") { opts.project = args[++i]; }
  else if (a === "-h" || a === "--help") { printUsage(); exit(0); }
  else if (a.startsWith("-")) { stderr.write(`unknown flag: ${a}\n`); exit(1); }
  else opts.file = a;
}

function printUsage() {
  stderr.write([
    "claude-code-to-md — Claude Code session → markdown",
    "",
    "  node scripts/claude-code-to-md.mjs                 latest session for cwd",
    "  node scripts/claude-code-to-md.mjs --list          list sessions",
    "  node scripts/claude-code-to-md.mjs <file.jsonl>    explicit file",
    "  node scripts/claude-code-to-md.mjs --project PATH  session for other repo",
    "  node scripts/claude-code-to-md.mjs --include-tools",
    "  node scripts/claude-code-to-md.mjs --include-thinking",
    "",
    "Piping:",
    "  node scripts/claude-code-to-md.mjs | bash scripts/tp-relay.sh",
    ""
  ].join("\n"));
}

// Claude Code encodes project paths by replacing any non-alphanumeric char with -.
function projectDirFor(projectPath) {
  const abs = resolve(projectPath);
  return abs.replace(/[^a-zA-Z0-9]/g, "-");
}

function latestInDir(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter(n => n.endsWith(".jsonl"))
    .map(n => ({ n, mtime: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? { path: join(dir, files[0].n), mtime: files[0].mtime } : null;
}

// Try exact cwd first, then walk up parent dirs. Handles git worktrees where
// Claude Code stored the session under the original repo root, not the
// worktree subdir. Also falls back to any project dir whose decoded path is a
// prefix of cwd (picks the most-recent session across matches).
function findLatestSession(projectPath) {
  const abs = resolve(projectPath);
  let cur = abs;
  while (true) {
    const hit = latestInDir(join(CLAUDE_ROOT, projectDirFor(cur)));
    if (hit) return hit.path;
    const parent = resolve(cur, "..");
    if (parent === cur) break;
    cur = parent;
  }
  if (!existsSync(CLAUDE_ROOT)) return null;
  const candidates = [];
  for (const name of readdirSync(CLAUDE_ROOT)) {
    if (name.startsWith(".")) continue;
    const decoded = "/" + name.replace(/^-/, "").replace(/-/g, "/");
    if (abs === decoded || abs.startsWith(decoded + "/")) {
      const hit = latestInDir(join(CLAUDE_ROOT, name));
      if (hit) candidates.push(hit);
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates.length ? candidates[0].path : null;
}

function listAll() {
  if (!existsSync(CLAUDE_ROOT)) { stderr.write(`No Claude Code data at ${CLAUDE_ROOT}\n`); exit(3); }
  const projects = readdirSync(CLAUDE_ROOT).filter(n => !n.startsWith("."));
  for (const p of projects) {
    const dir = join(CLAUDE_ROOT, p);
    const files = readdirSync(dir).filter(n => n.endsWith(".jsonl"))
      .map(n => ({ n, mtime: statSync(join(dir, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) continue;
    const decodedPath = p.replace(/-/g, "/");
    stderr.write(`\n${decodedPath}\n`);
    for (const f of files.slice(0, 5)) {
      const when = new Date(f.mtime).toISOString().slice(0, 16).replace("T", " ");
      stderr.write(`  ${when}  ${f.n}\n`);
    }
  }
}

if (opts.list) { listAll(); exit(0); }

const sessionFile = opts.file || findLatestSession(opts.project || cwd());
if (!sessionFile) {
  stderr.write(`No Claude Code sessions found for ${opts.project || cwd()}.\n`);
  stderr.write(`Run with --list to browse available sessions.\n`);
  exit(3);
}
if (!existsSync(sessionFile)) { stderr.write(`file not found: ${sessionFile}\n`); exit(3); }

const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);

// Extract renderable turns.
function contentToText(content, { includeThinking }) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    switch (c.type) {
      case "text":
        if (c.text) parts.push(c.text);
        break;
      case "thinking":
        if (includeThinking && c.thinking) parts.push(`> _thinking_: ${c.thinking}`);
        break;
      case "image":
        parts.push("[image attached]");
        break;
      case "tool_use":
        parts.push(`\n\`\`\`tool-call: ${c.name}\n${JSON.stringify(c.input, null, 2)}\n\`\`\``);
        break;
      case "tool_result": {
        const text = Array.isArray(c.content)
          ? c.content.filter(x => x?.type === "text").map(x => x.text).join("\n")
          : String(c.content ?? "");
        parts.push(`\n\`\`\`tool-result\n${text.slice(0, 4000)}${text.length > 4000 ? "\n… [truncated]" : ""}\n\`\`\``);
        break;
      }
      default: /* ignore */
    }
  }
  return parts.join("\n\n").trim();
}

const turns = [];
let firstUserPrompt = null;
let lastAssistantText = "";
let msgCount = 0;
let toolCallCount = 0;

for (const line of lines) {
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  if (obj.isSidechain) continue;
  if (obj.type !== "user" && obj.type !== "assistant") continue;

  const msg = obj.message || {};
  const role = msg.role || obj.type;

  // Filter tool_result-only user turns unless requested.
  const rawContent = msg.content;
  const isToolResultOnly = Array.isArray(rawContent)
    && rawContent.length > 0
    && rawContent.every(c => c?.type === "tool_result");

  if (isToolResultOnly && !opts.includeTools) continue;

  const text = contentToText(rawContent, { includeThinking: opts.includeThinking });
  if (!text || !text.trim()) continue;

  // Drop /relay slash-command noise so the receiving AI sees only substantive turns.
  //   - user-side: the raw `<command-message>relay</command-message>` marker
  //   - user-side: the tp-relay stdout echoed back into the transcript
  //   - assistant-side: short "Relay done. N bytes on clipboard" acks
  const trimmed = text.trim();
  if (role === "user" && /^<command-(message|name)>/.test(trimmed)) continue;
  if (role === "user" && /^(claude-code-to-md|tp-relay):/m.test(trimmed)) continue;
  if (role === "assistant" && /bytes on clipboard/.test(trimmed) && trimmed.length < 200) continue;

  // When tools disabled, strip tool_use blocks from assistant messages.
  let cleanedText = text;
  if (!opts.includeTools) {
    cleanedText = text.replace(/```tool-call:[\s\S]*?```/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!cleanedText) continue;
  }

  if (role === "user" && !firstUserPrompt) firstUserPrompt = cleanedText.slice(0, 200);
  if (role === "assistant") lastAssistantText = cleanedText.slice(0, 400);

  if (text.includes("tool-call:") || text.includes("tool-result")) toolCallCount++;

  turns.push({ role, text: cleanedText, ts: obj.timestamp });
  msgCount++;
}

if (msgCount === 0) {
  stderr.write(`Session contained no renderable text turns: ${sessionFile}\n`);
  exit(3);
}

// Compose markdown.
const projectPath = opts.project || (() => {
  // Recover the project path by decoding the dir name.
  const match = sessionFile.match(new RegExp(CLAUDE_ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\/([^/]+)"));
  return match ? "/" + match[1].split("-").slice(1).join("/") : "unknown";
})();

const firstTs = turns[0]?.ts ? new Date(turns[0].ts).toISOString() : new Date().toISOString();
const lines_out = [];
lines_out.push("# Claude Code CLI Session — Continuing conversation");
lines_out.push("");
lines_out.push(`- Project: \`${projectPath}\``);
lines_out.push(`- Session started: ${firstTs}`);
lines_out.push(`- Messages: ${msgCount}` + (toolCallCount ? ` · Tool activity: ${toolCallCount} turns` : ""));
lines_out.push("");
lines_out.push("## Briefing for the receiving AI");
lines_out.push("");
lines_out.push("You are continuing a coding session that began in the Claude Code CLI. Read the transcript below, absorb the context, and pick up exactly where the previous assistant left off. Start your reply with a one-line recap.");
lines_out.push("");
lines_out.push("---");
lines_out.push("");
lines_out.push("## Conversation Transcript");
lines_out.push("");

for (let i = 0; i < turns.length; i++) {
  const t = turns[i];
  const heading = t.role === "user" ? `### ${i + 1}. You` : `### ${i + 1}. Assistant (Claude Code)`;
  if (i > 0) lines_out.push("---");
  lines_out.push(heading);
  lines_out.push("");
  lines_out.push(t.text.replace(/^---(?=\s|$)/gm, "\\---"));
  lines_out.push("");
}

lines_out.push("---");
lines_out.push("");
lines_out.push("## ▶ Continue from here");
lines_out.push("");
lines_out.push("_Reply with your next step. The receiving AI should treat everything above as prior context._");

stdout.write(lines_out.join("\n") + "\n");
stderr.write(`claude-code-to-md: ${msgCount} turns from ${sessionFile}\n`);
