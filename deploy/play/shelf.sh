#!/bin/sh
# Puts this image's shelf on the volume, then the pointer to it (Plans/spelen-in-de-browser.md).
#
# The volume is what keeps the shelf before this one: a tab opened before a redeploy still asks
# its own play/<id>/ for a lazy module, and an image that held only the new build would answer it
# 404. So this copies the new shelf in beside the old ones (under a dot name first, then renamed,
# so nginx never serves half of one), writes version.json and the door only after that, and keeps
# the newest PLAY_KEEP shelves (3) by when they were last put out.
set -eu
SRC=/opt/play
DST=/usr/share/nginx/html/play
KEEP=${PLAY_KEEP:-3}
mkdir -p "$DST"
id=$(sed -n 's/.*"path":"\([^"]*\)".*/\1/p' "$SRC/version.json")
[ -n "$id" ] || { echo "shelf: $SRC/version.json names no shelf" >&2; exit 1; }
if [ ! -d "$DST/$id" ]; then
  rm -rf "$DST/.$id"
  cp -a "$SRC/$id" "$DST/.$id"
  mv "$DST/.$id" "$DST/$id"
fi
touch "$DST/$id"
for f in version.json index.html; do
  cp "$SRC/$f" "$DST/.$f"
  mv "$DST/.$f" "$DST/$f"
done
ls -1dt "$DST"/*/ | tail -n +"$((KEEP + 1))" | while read -r old; do
  name=$(basename "$old")
  [ "$name" = "$id" ] || { echo "shelf: putting away $name"; rm -rf "$old"; }
done
echo "shelf: the door leads to $id"
