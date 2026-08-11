#!/bin/zsh
# Search local TM snapshot for NEW / Idle (Attack) / Light Attacks / MASTER meshes.
# Read-only — does not restore unless you pass --restore-new

set -euo pipefail

SNAP='com.apple.TimeMachine.2026-08-10-141044.local'
MNT='/tmp/tm_oz_search'
ROOT="$MNT/Users/daneoleary/Documents/Work/Wizard of Oz Game"
MASTERS_NEW='/Users/daneoleary/Documents/Work/Wizard of Oz Game/masters/dorothy/Sprites/NEW'
WORKING_NEW='/Users/daneoleary/Documents/Work/Wizard of Oz Game/models/dorothy/Sprites/NEW'

RESTORE=0
[[ "${1:-}" == '--restore-new' ]] && RESTORE=1

mkdir -p "$MNT"
echo "Mounting $SNAP …"
if ! mount_apfs -o rdonly,nobrowse -s "$SNAP" /System/Volumes/Data "$MNT" 2>/tmp/tm_search_err; then
  echo "Mount failed:"; cat /tmp/tm_search_err; exit 1
fi
cleanup() { diskutil unmount force "$MNT" >/dev/null 2>&1 || umount "$MNT" 2>/dev/null || true; }
trap cleanup EXIT

echo "Root exists: $([[ -d $ROOT ]] && echo yes || echo no)"
echo
echo "=== dorothy top ==="
ls -la "$ROOT/models/dorothy" 2>&1 | head -30
echo
echo "=== dirs named NEW ==="
find "$ROOT" -type d -name 'NEW' 2>/dev/null
echo
echo "=== Idle (Attack) dirs ==="
find "$ROOT" -type d -iname '*idle*attack*' 2>/dev/null
echo
echo "=== idle-0.png ==="
find "$ROOT" -name 'idle-0.png' 2>/dev/null | head -20
echo
echo "=== Light Attacks ==="
find "$ROOT" -type d -iname '*light*attack*' 2>/dev/null
echo
echo "=== MASTER meshes ==="
ls "$ROOT/models/dorothy/MASTER" 2>&1 | head -20
echo
echo "=== file counts under dorothy ==="
echo -n "total files: "; find "$ROOT/models/dorothy" -type f ! -name '.DS_Store' 2>/dev/null | wc -l
echo -n "NEW files: "; find "$ROOT/models/dorothy/Sprites/NEW" -type f ! -name '.DS_Store' 2>/dev/null | wc -l

if [[ "$RESTORE" -eq 1 ]]; then
  SRC_NEW="$ROOT/models/dorothy/Sprites/NEW"
  if [[ ! -d "$SRC_NEW" ]]; then
    echo "No NEW folder in snapshot — nothing to restore."
    exit 2
  fi
  n=$(find "$SRC_NEW" -type f ! -name '.DS_Store' | wc -l | tr -d ' ')
  if [[ "$n" -eq 0 ]]; then
    echo "NEW exists but is empty in this snapshot."
    exit 3
  fi
  mkdir -p "$MASTERS_NEW" "$WORKING_NEW"
  echo "Restoring NEW ($n files) → masters + working…"
  rsync -a --stats "$SRC_NEW/" "$MASTERS_NEW/"
  rsync -a --stats "$MASTERS_NEW/" "$WORKING_NEW/"
  echo "OK"
fi
