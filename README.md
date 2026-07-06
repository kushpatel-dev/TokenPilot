# ⚡ TokenPilot — AI Prompt, Chat Transfer & Claude Code Bridge

**TokenPilot** is a premium Chrome extension + terminal bridge that supercharges your workflow across all major AI platforms — ChatGPT, Claude, Gemini, Perplexity, Mistral, DeepSeek, and more. It provides real-time token estimation, readability analysis, local prompt history, a first-of-its-kind **Chat Transfer** between web AIs, and — new in **v3.5** — a **Claude Code CLI relay** that lets you continue a terminal session inside any web AI with one slash command.

---

## 🚀 Key Features

### ⚡ Live Token Counter
- Real-time token estimation as you type, calibrated to the `cl100k_base` tokenizer (GPT-4, Claude, Gemini)
- Circular progress ring shows how much of the model's context window you've used
- Displays **% used** and **tokens free** at a glance
- Automatically detects which model you're on and adjusts the context limit

### 🌉 Claude Code CLI Bridge *(New in v3.5)*
Continue your **Claude Code CLI** session inside any web AI without copy-paste gymnastics.

**One-time setup** (from the cloned repo root):

```bash
bash install.sh
```

This wires up both slash commands globally — no per-project setup needed. Then, in any Claude Code CLI session:

- Type `/relay` → session copies to clipboard → switch to Claude.ai / ChatGPT / Gemini tab → TokenPilot popup offers **Import & paste**
- Type `/relay-download` → session saves as a portable `.md` file in `~/Downloads` for archiving, sharing, or continuing on a different machine
- Works from **any project directory**, not just the TokenPilot repo
- Automatically finds your latest session, filters tool noise, adds a briefing paragraph so the receiving AI knows how to continue
- Uninstall anytime: `bash install.sh --uninstall`

### 🔁 Chat Transfer *(v3.4)*
- Exports your **entire conversation** from any web AI into a structured **Markdown (`.md`) file**
- The file includes a YAML frontmatter header, role-labeled message blocks, and a ready-made continuation prompt — so the receiving AI picks up exactly where you left off
- **Token estimate shown before you download** — you'll know exactly how many tokens the file will consume when pasted into the new AI (`etm: 4.2K tokens`)
- Tested accuracy:
  - Short chats (5–15 msgs): **~95%** context retention
  - Medium chats (15–30 msgs): **~80–85%** context retention
  - Long chats (30+ msgs): **~70–75%** context retention

### 📊 Platform Info & Model Detection
- Detects which AI model you are using (GPT-4o, Claude Sonnet, Gemini 2.0, etc.)
- Shows platform-specific free-tier limits (e.g. *Free: ~10 msgs / 5h* for ChatGPT)
- Supports 13+ platforms and 30+ models out of the box

### 📝 Readability Analysis
- Scores your prompt as **Clear**, **Moderate**, or **Complex**
- Shows prompt strength: **Basic → Good → Strong → Expert**
- Detects prompt signals: role definition, structure hints, context richness
- Tips shown inline to help you write better prompts

### 🕓 Local Prompt History
- Automatically saves your last 50 prompts on every AI site
- Search, restore, copy, or delete any saved prompt
- Export your full history as **CSV** or **JSON**
- Works across all supported platforms

### 🔀 Model Comparator
- Shows how your current token count stacks up across GPT-4o, Claude, Gemini, o3, Mistral, and DeepSeek simultaneously
- Visual bar chart with percentage and context limit per model

---

## 🌐 Supported Platforms

| Platform | Chat Transfer | Token Count | History | Claude Code Relay |
|---|---|---|---|---|
| ChatGPT (chatgpt.com) | ✅ | ✅ | ✅ | ✅ receive |
| Claude (claude.ai) | ✅ | ✅ | ✅ | ✅ receive |
| Gemini (gemini.google.com) | ✅ | ✅ | ✅ | ✅ receive |
| AI Studio (aistudio.google.com) | ✅ | ✅ | ✅ | ✅ receive |
| Perplexity (perplexity.ai) | ✅ | ✅ | ✅ | ✅ receive |
| Mistral / Le Chat | ✅ | ✅ | ✅ | ✅ receive |
| DeepSeek (chat.deepseek.com) | ✅ | ✅ | ✅ | ✅ receive |
| GitHub Copilot | ✅ | ✅ | ✅ | — |
| Arena.ai | ✅ | ✅ | ✅ | — |
| **Claude Code CLI** | — | — | — | ✅ **source** |

---

## 🌉 How the Claude Code CLI Bridge Works

### `/relay` — live handoff via clipboard

1. Have a coding session in Claude Code CLI (any project directory)
2. Type `/relay` at the prompt
3. Terminal prints: `tp-relay: NNNN bytes on clipboard...`
4. Switch to a Claude.ai / ChatGPT / Gemini / any supported AI tab
5. TokenPilot popup appears:
   > **TokenPilot · Import chat from clipboard?**
   > [Dismiss]  [Import & paste]
6. Click **Import & paste** → transcript lands in the prompt box
7. Hit enter — the web AI continues where Claude Code left off

### `/relay-download` — portable `.md` file

1. Type `/relay-download` in Claude Code CLI
2. Saves as `~/Downloads/tokenpilot-<project>-<timestamp>.md`
3. Use it to:
   - Archive sessions for later reference
   - Share with a teammate over Slack/email
   - Continue on a different machine (paste into a fresh Claude Code CLI)

### Under the hood

- `install.sh` copies two small scripts to `~/.tokenpilot/` and writes slash-command definitions to `~/.claude/commands/`
- On `/relay`, the bridge reads the latest session JSONL from `~/.claude/projects/<encoded-cwd>/`, converts it to clean markdown, and pipes it to your system clipboard (via `pbcopy` / `wl-copy` / `xclip` / `clip.exe` — auto-detected per OS)
- The extension listens for a `TOKENPILOT-RELAY:v1` header on the clipboard and only prompts to import when it detects one — random clipboard content is never touched

---

## 🔁 How Chat Transfer Works (web AI → web AI)

1. Have a conversation on any supported web AI (e.g. Claude)
2. Click the **TokenPilot** extension icon
3. Click **"Transfer Chat to Another AI"**
4. A `.md` file downloads automatically — the popup shows the token cost (e.g. `✓ 23 msgs · etm: 4.2K tokens`)
5. Open a **new chat** on any other AI (e.g. ChatGPT or Gemini)
6. **Paste the entire file contents** as your first message
7. The receiving AI reads the full history and continues the conversation

### What the exported file looks like

```
---
title: TokenPilot Chat Transfer
platform: claude.ai
model: Claude Sonnet
exported: 5/9/2026, 11:30:00 AM
messages: 23
---

> **Instructions for the receiving AI**
> Read every message carefully and continue where the chat left off.

## Conversation Transcript

### 🧑 You
[your message]

---

### 🤖 Claude Sonnet
[AI response]

...

<!-- etm: 4.2K tokens used by this file -->
```

---

## 🛠️ Installation

### Prerequisites

- **Google Chrome** (or Edge, Brave, Arc — any Chromium browser)
- **Node.js** (only for the Claude Code CLI bridge) — check with `node -v`. Install via `brew install node` (macOS), `sudo apt install nodejs` (Linux), or from https://nodejs.org
- **Claude Code CLI** (optional, for `/relay` features) — https://claude.com/claude-code

### Step 1 — Clone the repo

```bash
git clone https://github.com/kushpatel-dev/TokenPilot.git
cd TokenPilot
```

### Step 2 — Install the terminal bridge (optional but recommended)

```bash
bash install.sh
```

This wires up `/relay` and `/relay-download` globally in Claude Code CLI. Detailed guide: [`INSTALL.md`](./INSTALL.md).

Uninstall anytime with `bash install.sh --uninstall`.

### Step 3 — Load the Chrome extension

1. Open `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select the `tokenpilot/` folder inside the cloned repo
5. Pin the extension icon from the puzzle-piece menu

Open any supported AI site — the ⚡ widget appears in the bottom-right corner.

### One-liner (for sharing)

```bash
git clone https://github.com/kushpatel-dev/TokenPilot.git && cd TokenPilot && bash install.sh
```

Then load `tokenpilot/` via `chrome://extensions` → **Load unpacked**.

---

## 📁 File Structure

```
TokenPilot/
├── install.sh                     # One-shot installer for terminal bridge
├── INSTALL.md                     # Detailed install guide
├── scripts/
│   ├── tp-relay.sh                # Bash wrapper: converts + clipboards/saves session
│   └── claude-code-to-md.mjs      # Node converter: JSONL → clean markdown
├── .claude/commands/
│   ├── relay.md                   # /relay slash command (clipboard mode)
│   └── relay-download.md          # /relay-download slash command (.md file mode)
└── tokenpilot/                    # Chrome extension (Load unpacked target)
    ├── manifest.json              # Extension config (v3.5)
    ├── popup.html                 # Extension popup UI
    ├── popup.js                   # Popup logic + Chat Transfer
    ├── background.js              # Service worker — stats & messaging
    ├── data/
    │   ├── models.js              # Model database (30+ models, context limits)
    │   └── modelRegistry.js       # Model registry helpers
    ├── utils/
    │   └── tokenCounter.js        # Token estimation + prompt analysis
    └── content/
        ├── content.js             # Main content script + conversation scraper
        ├── autopaste.js           # Auto-paste helper for receiving AIs
        ├── relayImporter.js       # Clipboard listener for /relay payloads
        └── styles.css             # Widget styles
```

---

## 🔒 Privacy & Security

- **No external API calls** — nothing leaves your browser or machine
- **Local storage only** — prompt history stored with `localStorage`
- **No account required** — works out of the box
- **No ads** — ever
- Chat Transfer and relay files are generated entirely on your device
- The terminal bridge only reads session files under `~/.claude/projects/` (data Claude Code itself already writes locally)
- Clipboard listener activates only when it sees a `TOKENPILOT-RELAY:v1` header — random clipboard content is ignored

---

## 🖥️ Tech Stack

- **Vanilla JavaScript** — zero dependencies, no build step
- **CSS3** — glassmorphic dark UI with animations
- **Chrome Manifest V3** — latest extension standards
- **cl100k_base heuristic** — token estimation calibrated to GPT-4 / Claude tokenizer
- **Bash + Node.js** — terminal bridge (no npm deps, pure stdlib)

---

## 📋 Changelog

### v3.5 *(current)*
- 🌉 **Claude Code CLI Bridge** — new `/relay` and `/relay-download` slash commands
- 📦 One-shot `install.sh` sets up terminal bridge globally in under 5 seconds
- 🔎 Clipboard-header detection (`TOKENPILOT-RELAY:v1`) so import popup only fires on relayed payloads
- 🧹 Cleans tool_use / tool_result noise from Claude Code sessions before handoff
- 🐛 Path-encoder fix — sessions now resolve correctly for project paths containing spaces or dots

### v3.4
- ✨ Added **Chat Transfer** — export any conversation as a `.md` file and continue on another AI
- ✨ Token estimate shown in popup and written inside the exported file (`etm: X tokens`)
- ✨ Conversation scrapers for ChatGPT, Claude, Gemini, Perplexity, Mistral, DeepSeek
- 🐛 Fixed popup `tabs` permission for cross-tab messaging

### v3.3
- ✨ Redesigned content script UI (tabs: Live / History / Compare)
- ✨ Model comparator across 6 models
- ✨ Prompt history export (CSV + JSON)
- ✨ Theme toggle (dark / light)

### v3.2
- ✨ Background service worker for persistent stats
- ✨ Prompt strength scoring (Basic → Expert)
- ✨ Readability analysis

---

Happy Prompting! ⚡
