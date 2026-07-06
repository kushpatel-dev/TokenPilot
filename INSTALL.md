# TokenPilot — Install Guide

TokenPilot lets you continue a Claude Code CLI session inside any web AI (Claude.ai, ChatGPT, Gemini, DeepSeek, Perplexity, Mistral) with one keystroke. This guide walks you through setup in about 3 minutes.

---

## What you'll install

1. **Chrome extension** — watches your clipboard and offers to import chats into web AIs.
2. **Terminal bridge** — two slash commands (`/relay`, `/relay-download`) for Claude Code CLI.

---

## Before you start — check prerequisites

Open a terminal and run:

```bash
node -v
```

- If it prints a version (e.g. `v20.11.0`) — good.
- If "command not found" — install Node.js:
  - **macOS:** `brew install node`
  - **Linux:** `sudo apt install nodejs`
  - **Windows:** download from https://nodejs.org

You'll also need:
- **Google Chrome** (or Edge, Brave, Arc — anything Chromium-based).
- **Claude Code CLI** — install from https://claude.com/claude-code if not already installed.
- **Bash** — built-in on macOS and Linux. On Windows, use WSL or Git Bash.

---

## Step 1 — Clone the repo

```bash
git clone https://github.com/kushpatel-dev/TokenPilot.git
cd TokenPilot
```

---

## Step 2 — Install the terminal bridge

Run one command:

```bash
bash install.sh
```

You should see output ending with:

```
[tokenpilot] Install complete.

  Scripts:      /Users/YOU/.tokenpilot
  Slash cmds:   /Users/YOU/.claude/commands/relay.md
                /Users/YOU/.claude/commands/relay-download.md
  Clipboard:    pbcopy
```

That's it — both slash commands are now globally available in Claude Code CLI.

---

## Step 3 — Load the Chrome extension

1. Open Chrome.
2. Go to `chrome://extensions` (paste this into the address bar).
3. Toggle **Developer mode** ON (top-right corner).
4. Click **Load unpacked**.
5. Navigate to the cloned `TokenPilot` folder and select the inner `tokenpilot/` folder.
6. The TokenPilot icon appears in your toolbar. Click the puzzle-piece icon and pin it.

---

## Step 4 — Try it out

Open Claude Code CLI in any project:

```bash
cd ~/some-project
claude
```

Have a short conversation with Claude. Then type either:

### `/relay` — live handoff via clipboard

Copies the session to your clipboard. Switch to a Claude.ai / ChatGPT / Gemini / etc tab. A TokenPilot popup appears:

> **TokenPilot · Import chat from clipboard?**
> [Dismiss]  [Import & paste]

Click **Import & paste**. The transcript is pasted into the prompt box. Hit enter — the receiving AI continues where Claude Code left off.

### `/relay-download` — save as .md file

Saves the session as:

```
~/Downloads/tokenpilot-<project-name>-<timestamp>.md
```

Use this to:
- Archive sessions for later.
- Email or Slack them to a teammate.
- Paste into a fresh Claude Code CLI session (even on a different machine).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No Claude Code sessions found` | You haven't run Claude Code from this directory yet. `cd` into a project where you've actually used it. |
| `node not installed` | Run `brew install node` (macOS) or `sudo apt install nodejs` (Linux). |
| `no clipboard tool found` | Linux only: `sudo apt install xclip`. |
| Popup never appears in the browser | Reload the extension at `chrome://extensions`, then click on the AI tab to refocus it. |
| Slash command not recognized | Restart Claude Code, or re-run `bash install.sh`. |

---

## Uninstall

```bash
cd TokenPilot
bash install.sh --uninstall
```

Removes `~/.tokenpilot/` and both slash commands. To remove the Chrome extension, go to `chrome://extensions` and click **Remove**.

---

## Quick-copy one-liner

For friends who just want to paste-and-go:

```bash
git clone https://github.com/kushpatel-dev/TokenPilot.git && cd TokenPilot && bash install.sh
```

Then load the extension via `chrome://extensions` → **Load unpacked** → pick the `tokenpilot/` folder.

---

## Support

- Repo: https://github.com/kushpatel-dev/TokenPilot
- Issues: https://github.com/kushpatel-dev/TokenPilot/issues
