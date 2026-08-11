#!/bin/zsh
# Restore Dorothy models (MASTER, Animations, meshes, etc.) from local TM snapshot
# into masters/, then seed models/. Does NOT touch masters that already exist
# unless --force. Sprites were restored separately.
#
# Note: this snapshot (2026-08-10 14:10) has NO Sprites/NEW or Idle (Attack).

set -euo pipefail

SNAP='com.apple.TimeMachine.2026-08-10-141044.local'
MNT='/tmp/tm_oz_dorothy'
SRC_ROOT="$MNT/Users/daneoleary/Documents/Work/Wizard of Oz Game/models/dorothy"
MASTERS='/Users/daneoleary/Documents/Work/Wizard of Oz Game/masters/dorothy'
WORKING='/Users/daneoleary/Documents/Work/Wizard of Oz Game/models/dorothy'

# Paths to pull (exist in this snapshot). Sprites already restored.
ITEMS=(
  MASTER
  Animations
  Old
  textures
  Dorothy_rigged.glb
  Dorothy_running.glb
  Dorothy_walking.glb
  ARMATURE_FORWARD.txt
  Dorothy_mixamo.fbm
  Dorothy_new.fbm
  tripo_orient
  tripo_rigging_fdaf7f26-3c12-4cb7-b6a4-6f6ec7d18d37.fbm
)

mkdir -p "$MNT"
echo "Mounting $SNAP …"
if ! mount_apfs -o rdonly,nobrowse -s "$SNAP" /System/Volumes/Data "$MNT" 2>/tmp/tm_dorothy_err; then
  echo "Mount failed:"; cat /tmp/tm_dorothy_err; exit 1
fi
cleanup() { diskutil unmount force "$MNT" >/dev/null 2>&1 || umount "$MNT" 2>/dev/null || true; }
trap cleanup EXIT

if [[ ! -d "$SRC_ROOT" ]]; then
  echo "Snapshot missing models/dorothy"
  exit 2
fi

mkdir -p "$MASTERS" "$WORKING"
for item in "${ITEMS[@]}"; do
  src="$SRC_ROOT/$item"
  if [[ ! -e "$src" ]]; then
    echo "skip (missing in snap): $item"
    continue
  fi
  echo "→ masters/dorothy/$item"
  rsync -a "$src" "$MASTERS/"
  echo "→ models/dorothy/$item (working)"
  rsync -a "$src" "$WORKING/"
done

echo
echo "masters/dorothy:"
ls -la "$MASTERS" | head -40
echo
echo -n "MASTER glbs: "; find "$MASTERS/MASTER" -name '*.glb' 2>/dev/null | wc -l
echo -n "Animation files: "; find "$MASTERS/Animations" -type f ! -name '.DS_Store' 2>/dev/null | wc -l
echo
echo "OK — meshes/anims in masters/dorothy (+ working under models/)."
echo "Sprites/NEW and Idle (Attack) are NOT in this snapshot."
