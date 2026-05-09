# ⚡ TokenPilot — AI Prompt & Chat Transfer Tool

**TokenPilot** is a premium Chrome extension that supercharges your workflow across all major AI platforms — ChatGPT, Claude, Gemini, Perplexity, Mistral, DeepSeek, and more. It provides real-time token estimation, readability analysis, local prompt history, and a first-of-its-kind **Chat Transfer** feature that lets you move an entire conversation from one AI to another — without losing any context.

---

## 🚀 Key Features

### ⚡ Live Token Counter
- Real-time token estimation as you type, calibrated to the `cl100k_base` tokenizer (GPT-4, Claude, Gemini)
- Circular progress ring shows how much of the model's context window you've used
- Displays **% used** and **tokens free** at a glance
- Automatically detects which model you're on and adjusts the context limit

### 🔁 Chat Transfer *(New in v3.4)*
- Exports your **entire conversation** from any AI platform into a structured **Markdown (`.md`) file**
- The file includes a YAML frontmatter header, role-labeled message blocks, and a ready-made continuation prompt — so the receiving AI picks up exactly where you left off
- **Token estimate shown before you download** — you'll know exactly how many tokens the file will consume when pasted into the new AI (`etm: 4.2K tokens`)
- Token count is also written at the bottom of every exported file for reference
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

| Platform | Transfer | Token Count | History |
|---|---|---|---|
| ChatGPT (chatgpt.com) | ✅ | ✅ | ✅ |
| Claude (claude.ai) | ✅ | ✅ | ✅ |
| Gemini (gemini.google.com) | ✅ | ✅ | ✅ |
| AI Studio (aistudio.google.com) | ✅ | ✅ | ✅ |
| Perplexity (perplexity.ai) | ✅ | ✅ | ✅ |
| Mistral / Le Chat | ✅ | ✅ | ✅ |
| DeepSeek (chat.deepseek.com) | ✅ | ✅ | ✅ |
| GitHub Copilot | ✅ | ✅ | ✅ |
| Arena.ai | ✅ | ✅ | ✅ |

---

## 🔁 How Chat Transfer Works

1. Have a conversation on any supported AI (e.g. Claude)
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

Since TokenPilot is a developer build, install it manually:

1. **Download**: Clone or download this repository to your computer
2. **Open Extensions**: In Chrome, Edge, or Brave go to `chrome://extensions`
3. **Developer Mode**: Enable the toggle in the top-right corner
4. **Load Unpacked**: Click **"Load unpacked"** and select the TokenPilot folder
5. **Done**: Open any supported AI site — the ⚡ widget appears in the bottom-right corner

---

## 📁 File Structure

```
tokenpilot/
├── manifest.json          # Extension config (v3.4)
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic + Chat Transfer
├── background.js          # Service worker — stats & messaging
├── data/
│   └── models.js          # Model database (30+ models, context limits)
├── utils/
│   └── tokenCounter.js    # Token estimation + prompt analysis
└── content/
    ├── content.js         # Main content script + conversation scraper
    └── styles.css         # Widget styles
```

---

## 🔒 Privacy & Security

- **No external API calls** — nothing leaves your browser
- **Local storage only** — prompt history stored with `localStorage`
- **No account required** — works out of the box
- **No ads** — ever
- The Chat Transfer file is generated entirely on your device and downloaded locally

---

## 🖥️ Tech Stack

- **Vanilla JavaScript** — zero dependencies, no build step
- **CSS3** — glassmorphic dark UI with animations
- **Chrome Manifest V3** — latest extension standards
- **cl100k_base heuristic** — token estimation calibrated to GPT-4 / Claude tokenizer

---

## 📋 Changelog

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
