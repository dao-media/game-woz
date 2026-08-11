#!/bin/zsh
# Scoped restore: Dorothy Sprites from today's local TM snapshot into masters/.
# Not a full system restore. Masters stay read-only; working copies go under models/.

set -euo pipefail

SNAP='com.apple.TimeMachine.2026-08-10-141044.local'
MASTERS='/Users/daneoleary/Documents/Work/Wizard of Oz Game/masters/dorothy/Sprites'
WORKING='/Users/daneoleary/Documents/Work/Wizard of Oz Game/models/dorothy/Sprites'
MNT='/tmp/tm_oz_sprites'
SRC="$MNT/Users/daneoleary/Documents/Work/Wizard of Oz Game/models/dorothy/Sprites"

echo "Mounting local snapshot: $SNAP"
mkdir -p "$MNT"

if ! mount_apfs -o rdonly,nobrowse -s "$SNAP" /System/Volumes/Data "$MNT" 2>/tmp/tm_mount_err; then
  echo "Mount failed:"
  cat /tmp/tm_mount_err
  echo
  echo "Fix: System Settings → Privacy & Security → Full Disk Access → enable Terminal"
  echo "Then run this script again."
  exit 1
fi

cleanup() {
  diskutil unmount force "$MNT" >/dev/null 2>&1 || umount "$MNT" 2>/dev/null || true
}
trap cleanup EXIT

echo "Source: $SRC"
if [[ ! -d "$SRC" ]]; then
  echo "Sprites folder not in this snapshot."
  ls -la "$MNT/Users/daneoleary/Documents/Work/Wizard of Oz Game/models/dorothy" 2>&1 | head -40 || true
  exit 2
fi

echo "Contents:"
ls -la "$SRC" | head -40

mkdir -p "$MASTERS"
echo
echo "Copying masters into: $MASTERS"
# macOS rsync (no GNU --info=stats2)
rsync -a --stats "$SRC/" "$MASTERS/"

mkdir -p "$WORKING"
echo
echo "Seeding working copy (models/) from masters — do not edit masters in place:"
rsync -a --stats "$MASTERS/" "$WORKING/"

echo
echo "Done. Master file count:"
find "$MASTERS" -type f ! -name '.DS_Store' | wc -l
echo
ls "$MASTERS"
echo
echo "OK — sprites in masters/dorothy/Sprites (+ working mirror under models/)."
