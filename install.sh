#!/usr/bin/env bash
# TokenPilot bridge installer — one-shot setup for the /relay slash command
# and terminal-side clipboard bridge.
#
# Usage:
#   bash install.sh                 # install into ~/.tokenpilot
#   bash install.sh --uninstall     # remove everything this installer wrote

set -euo pipefail

INSTALL_DIR="$HOME/.tokenpilot"
CMD_DIR="$HOME/.claude/commands"
CMD_FILE="$CMD_DIR/relay.md"
CMD_DOWNLOAD_FILE="$CMD_DIR/relay-download.md"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf "\033[1;36m[tokenpilot]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[tokenpilot]\033[0m %s\n" "$*" >&2; }
err()  { printf "\033[1;31m[tokenpilot]\033[0m %s\n" "$*" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  log "Removing $INSTALL_DIR, $CMD_FILE, $CMD_DOWNLOAD_FILE"
  rm -rf "$INSTALL_DIR"
  rm -f  "$CMD_FILE" "$CMD_DOWNLOAD_FILE"
  log "Uninstalled."
  exit 0
fi

# 1. Preflight checks
command -v node >/dev/null 2>&1 || err "node is required. Install from https://nodejs.org and retry."
command -v bash >/dev/null 2>&1 || err "bash is required."

# Clipboard tool detection (informational)
if   command -v pbcopy    >/dev/null 2>&1; then CLIP="pbcopy"
elif command -v wl-copy   >/dev/null 2>&1; then CLIP="wl-copy"
elif command -v xclip     >/dev/null 2>&1; then CLIP="xclip"
elif command -v xsel      >/dev/null 2>&1; then CLIP="xsel"
elif command -v clip.exe  >/dev/null 2>&1; then CLIP="clip.exe"
else
  warn "No clipboard tool detected (pbcopy/wl-copy/xclip/xsel/clip.exe). Install one before using /relay."
  CLIP="none"
fi

# 2. Copy scripts into ~/.tokenpilot
log "Installing scripts to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

SRC_RELAY="$SCRIPT_DIR/scripts/tp-relay.sh"
SRC_CONV="$SCRIPT_DIR/scripts/claude-code-to-md.mjs"

[ -f "$SRC_RELAY" ] || err "Missing $SRC_RELAY — run this installer from the TokenPilot repo root."
[ -f "$SRC_CONV"  ] || err "Missing $SRC_CONV."

cp "$SRC_RELAY" "$INSTALL_DIR/tp-relay.sh"
cp "$SRC_CONV"  "$INSTALL_DIR/claude-code-to-md.mjs"
chmod +x "$INSTALL_DIR/tp-relay.sh"

# 3. Write /relay and /relay-download slash commands for Claude Code CLI
log "Writing slash commands to $CMD_DIR"
mkdir -p "$CMD_DIR"
cat > "$CMD_FILE" <<EOF
---
description: Copy latest Claude Code session to clipboard for TokenPilot
allowed-tools: Bash(bash $INSTALL_DIR/tp-relay.sh:*)
---

!\`bash $INSTALL_DIR/tp-relay.sh --claude-code\`
EOF

cat > "$CMD_DOWNLOAD_FILE" <<EOF
---
description: Save latest Claude Code session as a .md file in ~/Downloads (portable, share/archive)
allowed-tools: Bash(bash $INSTALL_DIR/tp-relay.sh:*)
---

!\`bash $INSTALL_DIR/tp-relay.sh --claude-code --download\`
EOF

# 4. Smoke test
log "Smoke test..."
if node "$INSTALL_DIR/claude-code-to-md.mjs" --list >/dev/null 2>&1; then
  log "Converter OK."
else
  warn "Converter ran but no Claude sessions found yet — expected on first install."
fi

cat <<DONE

[tokenpilot] Install complete.

  Scripts:      $INSTALL_DIR
  Slash cmds:   $CMD_FILE
                $CMD_DOWNLOAD_FILE
  Clipboard:    $CLIP

Next steps:
  1. Load the Chrome extension: chrome://extensions -> Load unpacked -> pick the 'tokenpilot' folder from this repo.
  2. Open Claude Code in any project.
       /relay          -> clipboard, triggers extension popup on next AI tab focus
       /relay-download -> saves ~/Downloads/tokenpilot-<project>-<ts>.md for share/archive
  3. Switch to claude.ai / ChatGPT — TokenPilot popup will offer to import (for /relay).

Uninstall anytime:  bash install.sh --uninstall
DONE
