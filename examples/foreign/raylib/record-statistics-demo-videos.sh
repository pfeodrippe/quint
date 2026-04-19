#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$example_dir/../../.." && pwd)"
quint_dir="$repo_dir/quint"
native_dir="$example_dir/native-rust"

bun_bin="${BUN_BIN:-/Users/pfeodrippe/.copilot/session-state/60828afc-9168-4f34-8584-e906365614f0/files/bun/bin/bun}"
output_dir="${OUTPUT_DIR:-$repo_dir/out/raylib-statistics-videos}"
frame_rate="${FRAME_RATE:-30}"
narration_voice="${NARRATION_VOICE:-Thomas}"
narration_rate="${NARRATION_RATE:-170}"
tap_delay_ms="${QUINT_RAYLIB_TAP_DELAY_MS:-55}"
tap_render_interval_ms="${QUINT_RAYLIB_TAP_RENDER_INTERVAL_MS:-55}"
capture_interval_ms="${CAPTURE_INTERVAL_MS:-$((1000 / frame_rate))}"
target_merged_duration_sec="${TARGET_MERGED_DURATION_SEC:-}"
skip_clip_recording="${SKIP_CLIP_RECORDING:-0}"
skip_narration="${SKIP_NARRATION:-0}"
window_content_width="${WINDOW_CONTENT_WIDTH:-1280}"
window_content_height="${WINDOW_CONTENT_HEIGHT:-760}"
window_titlebar_height="${WINDOW_TITLEBAR_HEIGHT:-28}"

targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then
  targets=(tendermint bank paxos queue-v1 queue-v2)
fi

mkdir -p "$output_dir/clips" "$output_dir/frames"

if [[ ! -x "$bun_bin" ]]; then
  echo "Bun binary not found: $bun_bin" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required" >&2
  exit 1
fi

if [[ "${QUINT_RAYLIB_SKIP_BUILD:-0}" != "1" ]]; then
  npm --prefix "$quint_dir" run compile >/dev/null
  cargo build --manifest-path "$native_dir/Cargo.toml" >/dev/null
fi

main_screen_metrics() {
  swift -e 'import AppKit; let s = NSScreen.screens[0]; let v = s.visibleFrame; print("\(Int(v.origin.x)),\(Int(v.origin.y)),\(Int(v.width)),\(Int(v.height))")'
}

target_samples() {
  if [[ -n "${SAMPLES_OVERRIDE:-}" ]]; then
    echo "$SAMPLES_OVERRIDE"
    return
  fi

  case "$1" in
    tendermint) echo 18 ;;
    bank) echo 10 ;;
    paxos) echo 24 ;;
    queue-v1) echo 20 ;;
    queue-v2) echo 20 ;;
    *) echo 15 ;;
  esac
}

target_seed() {
  if [[ -n "${SEED_OVERRIDE:-}" ]]; then
    echo "$SEED_OVERRIDE"
    return
  fi

  case "$1" in
    tendermint) echo 40 ;;
    bank) echo 7 ;;
    paxos) echo 7 ;;
    queue-v1) echo 7 ;;
    queue-v2) echo 7 ;;
    *) echo 1 ;;
  esac
}

target_max_steps() {
  if [[ -n "${MAX_STEPS_OVERRIDE:-}" ]]; then
    echo "$MAX_STEPS_OVERRIDE"
    return
  fi

  case "$1" in
    bank) echo 18 ;;
    queue-v1) echo 32 ;;
    queue-v2) echo 32 ;;
    *) echo "" ;;
  esac
}

window_geometry() {
  local metrics
  local visible_x
  local visible_y
  local visible_width
  local visible_height
  local frame_height
  local x
  local y

  metrics="$(main_screen_metrics)"
  IFS=',' read -r visible_x visible_y visible_width visible_height <<<"$metrics"
  visible_x="${visible_x// /}"
  visible_y="${visible_y// /}"
  visible_width="${visible_width// /}"
  visible_height="${visible_height// /}"
  frame_height=$((window_content_height + window_titlebar_height))
  x=$((visible_x + (visible_width - window_content_width) / 2))
  y=$((visible_y + (visible_height - frame_height) / 2))

  printf '%s,%s\n' "$x" "$y"
}

clip_path_for_target() {
  local index="$1"
  local target="$2"
  printf '%s/clips/%02d-%s.mp4\n' "$output_dir" "$index" "$target"
}

media_duration() {
  ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$1"
}

atempo_filter_chain() {
  awk -v speed="$1" 'BEGIN {
    n = 0
    while (speed > 2.0 + 1e-9) {
      parts[n++] = "atempo=2.0"
      speed /= 2.0
    }
    while (speed < 0.5 - 1e-9) {
      parts[n++] = "atempo=0.5"
      speed /= 0.5
    }
    parts[n++] = sprintf("atempo=%.6f", speed)
    for (i = 0; i < n; i++) {
      printf "%s%s", parts[i], (i + 1 < n ? "," : "")
    }
    printf "\n"
  }'
}

record_target() {
  local index="$1"
  local target="$2"
  local samples
  local seed
  local max_steps
  local prefix
  local clip_path
  local frames_dir
  local geometry
  local window_x
  local window_y

  samples="$(target_samples "$target")"
  seed="$(target_seed "$target")"
  max_steps="$(target_max_steps "$target")"
  prefix="$(printf '%02d-%s' "$index" "$target")"
  clip_path="$output_dir/clips/$prefix.mp4"
  frames_dir="$output_dir/frames/$prefix"
  rm -rf "$frames_dir"
  mkdir -p "$frames_dir"
  rm -f "$clip_path"
  geometry="$(window_geometry)"
  IFS=',' read -r window_x window_y <<<"$geometry"

  if [[ -n "$max_steps" ]]; then
    BUN_BIN="$bun_bin" \
    QUINT_RAYLIB_CAPTURE_FRAMES_DIR="$frames_dir" \
    QUINT_RAYLIB_CAPTURE_INTERVAL_MS="$capture_interval_ms" \
    QUINT_RAYLIB_SKIP_BUILD=1 \
    QUINT_RAYLIB_WINDOW_X="$window_x" \
    QUINT_RAYLIB_WINDOW_Y="$window_y" \
    QUINT_RAYLIB_TAP_DELAY_MS="$tap_delay_ms" \
    QUINT_RAYLIB_TAP_RENDER_INTERVAL_MS="$tap_render_interval_ms" \
    bash "$example_dir/run-statistics-live.sh" "$target" "$samples" "$seed" "$max_steps"
  else
    BUN_BIN="$bun_bin" \
    QUINT_RAYLIB_CAPTURE_FRAMES_DIR="$frames_dir" \
    QUINT_RAYLIB_CAPTURE_INTERVAL_MS="$capture_interval_ms" \
    QUINT_RAYLIB_SKIP_BUILD=1 \
    QUINT_RAYLIB_WINDOW_X="$window_x" \
    QUINT_RAYLIB_WINDOW_Y="$window_y" \
    QUINT_RAYLIB_TAP_DELAY_MS="$tap_delay_ms" \
    QUINT_RAYLIB_TAP_RENDER_INTERVAL_MS="$tap_render_interval_ms" \
    bash "$example_dir/run-statistics-live.sh" "$target" "$samples" "$seed"
  fi

  if ! find "$frames_dir" -maxdepth 1 -name 'frame-*.png' -print -quit | grep -q .; then
    echo "Failed to capture frames for $target" >&2
    return 1
  fi

  ffmpeg -y \
    -framerate "$frame_rate" \
    -start_number 0 \
    -i "$frames_dir/frame-%06d.png" \
    -an \
    -c:v libx264 \
    -preset veryfast \
    -pix_fmt yuv420p \
    -movflags +faststart \
    "$clip_path" >/dev/null 2>&1
}

concat_list="$output_dir/concat-list.txt"
>"$concat_list"

index=1
for target in "${targets[@]}"; do
  clip_path="$(clip_path_for_target "$index" "$target")"
  if [[ "$skip_clip_recording" != "1" ]]; then
    record_target "$index" "$target"
  elif [[ ! -f "$clip_path" ]]; then
    echo "Missing existing clip for $target: $clip_path" >&2
    exit 1
  fi
  printf "file '%s'\n" "$clip_path" >>"$concat_list"
  index=$((index + 1))
done

silent_source="$output_dir/quint-statistics-demos-silent-source.mp4"
silent_video="$output_dir/quint-statistics-demos-silent.mp4"
ffmpeg -y -f concat -safe 0 -i "$concat_list" -c copy "$silent_source" >/dev/null 2>&1

if [[ -n "$target_merged_duration_sec" ]]; then
  source_duration="$(media_duration "$silent_source")"
  video_speed_factor="$(awk -v duration="$source_duration" -v target="$target_merged_duration_sec" 'BEGIN { printf "%.8f", duration / target }')"
  ffmpeg -y \
    -i "$silent_source" \
    -an \
    -vf "setpts=PTS/${video_speed_factor}" \
    -c:v libx264 \
    -preset veryfast \
    -pix_fmt yuv420p \
    -movflags +faststart \
    "$silent_video" >/dev/null 2>&1
else
  cp "$silent_source" "$silent_video"
fi

narration_text="$output_dir/narration-fr.txt"
if [[ "$skip_narration" != "1" ]]; then
cat >"$narration_text" <<'EOF'
Voici cinq démonstrations Quint dans l'interface raylib des statistiques en direct.

Tendermint montre les signaux qui ont servi à guider les gains de performance côté implémentation réelle : décisions, tours et coût de preuve.

Bank résume la pression du trafic, la répartition de l'état et l'équilibre entre transferts réussis et échoués.

Paxos met en évidence l'accumulation des votes, le coût en messages et la vitesse à laquelle une valeur devient choisie.

Queue version un donne la ligne de base du travail restant et du backlog.

Enfin, Queue version deux visualise le même scénario avec un meilleur écoulement du backlog et du travail restant.
EOF

narration_aiff="$output_dir/narration-fr.aiff"
narration_audio="$output_dir/narration-fr.m4a"
narration_audio_final="$narration_audio"
say -v "$narration_voice" -r "$narration_rate" -f "$narration_text" -o "$narration_aiff"
ffmpeg -y -i "$narration_aiff" -c:a aac -b:a 192k "$narration_audio" >/dev/null 2>&1

if [[ -n "$target_merged_duration_sec" ]]; then
  narration_audio_final="$output_dir/narration-fr-${target_merged_duration_sec}s.m4a"
  narration_duration="$(media_duration "$narration_audio")"
  audio_speed_factor="$(awk -v duration="$narration_duration" -v target="$target_merged_duration_sec" 'BEGIN { printf "%.8f", duration / target }')"
  audio_filter_chain="$(atempo_filter_chain "$audio_speed_factor")"
  ffmpeg -y \
    -i "$narration_audio" \
    -filter:a "${audio_filter_chain},apad,atrim=duration=${target_merged_duration_sec}" \
    -c:a aac \
    -b:a 192k \
    "$narration_audio_final" >/dev/null 2>&1
fi

narrated_video="$output_dir/quint-statistics-demos-fr.mp4"
ffmpeg -y \
  -i "$silent_video" \
  -i "$narration_audio_final" \
  -filter_complex "[1:a]apad[audio]" \
  -map 0:v:0 \
  -map "[audio]" \
  -c:v copy \
  -c:a aac \
  -shortest \
  "$narrated_video" >/dev/null 2>&1
else
  rm -f \
    "$output_dir/quint-statistics-demos-fr.mp4" \
    "$output_dir/narration-fr.txt" \
    "$output_dir/narration-fr.aiff" \
    "$output_dir/narration-fr.m4a" \
    "$output_dir/narration-fr-15s.m4a" \
    "$output_dir/narration-fr-30s.m4a"
fi

printf 'Outputs written to %s\n' "$output_dir"
