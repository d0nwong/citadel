#!/usr/bin/env bash
# Fire an OS desktop notification that a review is ready.
#
# Usage: notify.sh "TITLE" "MESSAGE"
# Keep MESSAGE free of double quotes (osascript escaping is finicky).
set -u
TITLE="${1:-office-hours}"
MSG="${2:-Review ready}"

if command -v terminal-notifier >/dev/null 2>&1; then
  terminal-notifier -title "$TITLE" -message "$MSG" -sound default >/dev/null 2>&1 && exit 0
fi
if command -v osascript >/dev/null 2>&1; then
  # sanitize quotes so the AppleScript string stays valid
  safe_msg=${MSG//\"/}
  safe_title=${TITLE//\"/}
  osascript -e "display notification \"$safe_msg\" with title \"$safe_title\" sound name \"Glass\"" \
    >/dev/null 2>&1 && exit 0
fi
if command -v notify-send >/dev/null 2>&1; then
  notify-send "$TITLE" "$MSG" && exit 0
fi
# last resort: print so the loop transcript still records it
echo "NOTIFY: $TITLE — $MSG"
