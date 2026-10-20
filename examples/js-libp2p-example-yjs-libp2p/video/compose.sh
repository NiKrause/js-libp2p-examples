#!/usr/bin/env bash
# After a recording run: keep the two videos (results/ is wiped on the next
# run), cut the connection wait, and put the browsers side by side.
#   video/compose.sh <out dir>
set -euo pipefail
cd "$(dirname "$0")"
out="${1:-out}"; mkdir -p "$out"
dir=$(ls -d results/sheet-demo-* | head -1)
a=$(ls "$dir"/a/*.webm | head -1); b=$(ls "$dir"/b/*.webm | head -1)
# Start 4 s before the peers connected.
start=$(node -e "const t=require('./$dir/timing.json').connectedAt; console.log(Math.max(0, t-4).toFixed(1))")
ffmpeg -nostdin -v error -y -ss "$start" -i "$a" -ss "$start" -i "$b" \
  -filter_complex "[0:v]scale=960:720,setsar=1[l];[1:v]scale=960:720,setsar=1[r];[l][r]hstack=inputs=2" \
  -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "$out/sheet-demo.mp4"
echo "sheet demo: $out/sheet-demo.mp4 (cut at ${start}s)"
