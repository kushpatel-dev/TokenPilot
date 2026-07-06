#!/usr/bin/env bash
# tp-relay — Terminal-side companion for TokenPilot.
# Wraps a session transcript with the TP-relay header and puts it on the
# system clipboard. The TokenPilot Chrome extension picks it up on the next
# focus of a supported AI tab.
#
# Usage:
#   ./tp-relay.sh path/to/session.md
#   cat session.md | ./tp-relay.sh
#   ./tp-relay.sh --claude-code   # auto-detect latest Claude Code session
#
# Exit codes: 0 success · 1 bad args · 2 clipboard failure · 3 source missing.

set -euo pipefail

VERSION=1
SOURCE_LABEL="${TP_RELAY_SOURCE:-cli}"

usage() {
  cat >&2 <<EOF
tp-relay — pipe a chat transcript to the TokenPilot Chrome extension.

Usage:
  tp-relay <file>
  cat file | tp-relay
  tp-relay --claude-code            # latest ~/.claude/projects/**/session
  tp-relay --source LABEL <file>    # override source tag in header
  tp-relay --claude-code --download # save transcript as .md file (no clipboard)
  tp-relay --claude-code --download DIR
                                    # save into DIR (default ~/Downloads)
EOF
  exit 1
}

copy_to_clipboard() {
  local payload="$1"
  if command -v pbcopy >/dev/null 2>&1; then
    printf %s "$payload" | pbcopy
  elif command -v wl-copy >/dev/null 2>&1; then
    printf %s "$payload" | wl-copy
  elif command -v xclip >/dev/null 2>&1; then
    printf %s "$payload" | xclip -selection clipboard
  elif command -v xsel >/dev/null 2>&1; then
    printf %s "$payload" | xsel --clipboard --input
  elif command -v clip.exe >/dev/null 2>&1; then
    printf %s "$payload" | clip.exe
  else
    echo "tp-relay: no clipboard tool found (pbcopy/wl-copy/xclip/xsel/clip.exe)" >&2
    return 2
  fi
}

# Convert the latest Claude Code CLI session for the current cwd to markdown.
# Delegates to claude-code-to-md.mjs (Node, no deps).
run_claude_code_converter() {
  local script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  local converter="$script_dir/claude-code-to-md.mjs"
  [ -f "$converter" ] || { echo "tp-relay: converter not found at $converter" >&2; return 3; }
  command -v node >/dev/null 2>&1 || { echo "tp-relay: node not installed" >&2; return 3; }
  node "$converter"
}

INPUT=""
SOURCE="$SOURCE_LABEL"
CLAUDE_CODE_MODE=0
DOWNLOAD_MODE=0
DOWNLOAD_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --source) SOURCE="$2"; shift 2 ;;
    --claude-code) CLAUDE_CODE_MODE=1; SOURCE="claude-code-cli"; shift ;;
    --download)
      DOWNLOAD_MODE=1
      # Optional next arg is a directory (must not start with '-')
      if [ $# -gt 1 ] && [ -n "${2:-}" ] && [ "${2#-}" = "$2" ]; then
        DOWNLOAD_DIR="$2"; shift 2
      else
        shift
      fi
      ;;
    -*) echo "tp-relay: unknown flag $1" >&2; usage ;;
    *) INPUT="$1"; shift ;;
  esac
done

if [ "$CLAUDE_CODE_MODE" = "1" ]; then
  BODY="$(run_claude_code_converter)" || exit $?
elif [ -n "$INPUT" ]; then
  [ -f "$INPUT" ] || { echo "tp-relay: file not found: $INPUT" >&2; exit 3; }
  BODY="$(cat "$INPUT")"
else
  if [ -t 0 ]; then usage; fi
  BODY="$(cat)"
fi

BYTES=${#BODY}
[ "$BYTES" -gt 0 ] || { echo "tp-relay: empty input" >&2; exit 3; }

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

PAYLOAD=$(cat <<HEADER
<!-- TOKENPILOT-RELAY:v${VERSION} -->
<!-- source: ${SOURCE} -->
<!-- ts: ${TS} -->
<!-- bytes: ${BYTES} -->

${BODY}
HEADER
)

if [ "$DOWNLOAD_MODE" = "1" ]; then
  OUT_DIR="${DOWNLOAD_DIR:-$HOME/Downloads}"
  mkdir -p "$OUT_DIR" || { echo "tp-relay: cannot create $OUT_DIR" >&2; exit 2; }
  PROJECT_SLUG="$(basename "$PWD" | tr ' /' '--')"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  OUT_FILE="$OUT_DIR/tokenpilot-${PROJECT_SLUG}-${STAMP}.md"
  printf %s "$PAYLOAD" > "$OUT_FILE" || { echo "tp-relay: write failed" >&2; exit 2; }
  echo "tp-relay: saved ${BYTES} bytes -> ${OUT_FILE}"
  echo "tp-relay: paste this file's content into another Claude Code CLI (or any AI) to continue."
elif copy_to_clipboard "$PAYLOAD"; then
  echo "tp-relay: ${BYTES} bytes on clipboard (source=${SOURCE}). Open Claude/ChatGPT — TokenPilot will prompt to import."
else
  exit 2
fi
