#!/usr/bin/env bash
# Assembles the recorded raw scenes (scripts/record-demo-video.ts) and the
# rendered cards (scripts/render-demo-video-cards.ts) into the final demo mp4.
set -euo pipefail

RAW_DIR="output/demo-video/raw"
CARDS_DIR="output/demo-video/cards"
OUT_DIR="output/demo-video"
FINAL="$OUT_DIR/proofofhack-demo.mp4"
XFADE=0.6
CARD_SECONDS=5

duration() {
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"
}

mkdir -p "$OUT_DIR"

ffmpeg -y -f lavfi -i "color=c=0xf6f7f3:s=1920x1080:d=${CARD_SECONDS}:r=25" \
  -i "$CARDS_DIR/title-card.png" \
  -filter_complex "[1:v]scale=1920:1080[img];[0:v][img]overlay=0:0[v]" \
  -map "[v]" -c:v libx264 -pix_fmt yuv420p -r 25 -t "$CARD_SECONDS" "$OUT_DIR/title.mp4" -loglevel error

ffmpeg -y -f lavfi -i "color=c=0xf6f7f3:s=1920x1080:d=${CARD_SECONDS}:r=25" \
  -i "$CARDS_DIR/end-card.png" \
  -filter_complex "[1:v]scale=1920:1080[img];[0:v][img]overlay=0:0[v]" \
  -map "[v]" -c:v libx264 -pix_fmt yuv420p -r 25 -t "$CARD_SECONDS" "$OUT_DIR/end.mp4" -loglevel error

d0=$CARD_SECONDS
d1=$(duration "$RAW_DIR/01-landing.webm")
d2=$(duration "$RAW_DIR/02-protocol.webm")
d3=$(duration "$RAW_DIR/03-researcher-submit.webm")
d4=$(duration "$RAW_DIR/04-payout.webm")
d5=$(duration "$RAW_DIR/05-protocol-unlock.webm")
d6=$CARD_SECONDS

L0=$d0
o1=$(echo "$L0 - $XFADE" | bc); L1=$(echo "$L0 + $d1 - $XFADE" | bc)
o2=$(echo "$L1 - $XFADE" | bc); L2=$(echo "$L1 + $d2 - $XFADE" | bc)
o3=$(echo "$L2 - $XFADE" | bc); L3=$(echo "$L2 + $d3 - $XFADE" | bc)
o4=$(echo "$L3 - $XFADE" | bc); L4=$(echo "$L3 + $d4 - $XFADE" | bc)
o5=$(echo "$L4 - $XFADE" | bc); L5=$(echo "$L4 + $d5 - $XFADE" | bc)
o6=$(echo "$L5 - $XFADE" | bc); L6=$(echo "$L5 + $d6 - $XFADE" | bc)

echo "Scene durations: title=$d0 landing=$d1 protocol=$d2 submit=$d3 payout=$d4 unlock=$d5 end=$d6"
echo "Final duration: ${L6}s"

# Lower-third overlay windows, placed safely inside each scene's fully-visible span.
label_protocol_start=$(echo "$L1 + 1.0" | bc)
label_protocol_end=$(echo "$label_protocol_start + 4" | bc)
label_researcher_start=$(echo "$L2 + 1.0" | bc)
label_researcher_end=$(echo "$label_researcher_start + 4" | bc)
circle_start=$(echo "$L3 + 3.5" | bc)
circle_end=$(echo "$circle_start + 4" | bc)

ffmpeg -y \
  -i "$OUT_DIR/title.mp4" \
  -i "$RAW_DIR/01-landing.webm" \
  -i "$RAW_DIR/02-protocol.webm" \
  -i "$RAW_DIR/03-researcher-submit.webm" \
  -i "$RAW_DIR/04-payout.webm" \
  -i "$RAW_DIR/05-protocol-unlock.webm" \
  -i "$OUT_DIR/end.mp4" \
  -loop 1 -i "$CARDS_DIR/label-protocol.png" \
  -loop 1 -i "$CARDS_DIR/label-researcher.png" \
  -loop 1 -i "$CARDS_DIR/lower-third-circle.png" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
  -filter_complex "\
[0:v]fps=25,settb=1/25[v0]; \
[1:v]fps=25,settb=1/25[v1]; \
[2:v]fps=25,settb=1/25[v2]; \
[3:v]fps=25,settb=1/25[v3]; \
[4:v]fps=25,settb=1/25[v4]; \
[5:v]fps=25,settb=1/25[v5]; \
[6:v]fps=25,settb=1/25[v6]; \
[v0][v1]xfade=transition=fade:duration=${XFADE}:offset=${o1}[x1]; \
[x1][v2]xfade=transition=fade:duration=${XFADE}:offset=${o2}[x2]; \
[x2][v3]xfade=transition=fade:duration=${XFADE}:offset=${o3}[x3]; \
[x3][v4]xfade=transition=fade:duration=${XFADE}:offset=${o4}[x4]; \
[x4][v5]xfade=transition=fade:duration=${XFADE}:offset=${o5}[x5]; \
[x5][v6]xfade=transition=fade:duration=${XFADE}:offset=${o6}[x6]; \
[x6][7:v]overlay=0:0:shortest=1:enable='between(t,${label_protocol_start},${label_protocol_end})'[x7]; \
[x7][8:v]overlay=0:0:shortest=1:enable='between(t,${label_researcher_start},${label_researcher_end})'[x8]; \
[x8][9:v]overlay=0:0:shortest=1:enable='between(t,${circle_start},${circle_end})'[vout]" \
  -map "[vout]" -map 10:a \
  -c:v libx264 -pix_fmt yuv420p -r 25 -c:a aac -shortest \
  "$FINAL" -loglevel error -stats

echo ""
echo "Final video written to $FINAL"
ffprobe -v error -show_entries format=duration:stream=width,height,codec_name -of default=noprint_wrappers=1 "$FINAL"
