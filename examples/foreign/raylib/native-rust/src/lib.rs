use raylib::ffi;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::env;
use std::ffi::{c_char, CStr, CString};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

#[derive(Clone)]
struct CircleCommand {
    x: i32,
    y: i32,
    radius: f32,
    color: ffi::Color,
}

#[derive(Clone)]
struct TextCommand {
    text: String,
    x: i32,
    y: i32,
    font_size: i32,
    color: ffi::Color,
}

#[derive(Clone)]
struct RectCommand {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    color: ffi::Color,
}

struct HostState {
    window_open: bool,
    closed_by_user: bool,
    batching: bool,
    counter: i64,
    circles: Vec<CircleCommand>,
    rects: Vec<RectCommand>,
    screenshot_path: Option<String>,
    screenshot_taken: bool,
    tap_delay_ms: u64,
    tap_render_interval_ms: u64,
    last_tap_render_ms: u64,
    tap_portal: Option<TapPortalState>,
    texts: Vec<TextCommand>,
}

impl Default for HostState {
    fn default() -> Self {
        Self {
            window_open: false,
            closed_by_user: false,
            batching: false,
            counter: 0,
            circles: Vec::new(),
            rects: Vec::new(),
            screenshot_path: env::var("QUINT_RAYLIB_SCREENSHOT_PATH").ok(),
            screenshot_taken: false,
            tap_delay_ms: env::var("QUINT_RAYLIB_TAP_DELAY_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0),
            tap_render_interval_ms: env::var("QUINT_RAYLIB_TAP_RENDER_INTERVAL_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(1000),
            last_tap_render_ms: 0,
            tap_portal: None,
            texts: Vec::new(),
        }
    }
}

#[derive(Clone)]
struct TapPortalState {
    latest_event: Option<TapPortalEvent>,
    total_events: usize,
    stats_by_label: BTreeMap<String, TapLabelStats>,
}

#[derive(Clone, Default)]
struct TapLabelStats {
    location: String,
    sample_count: usize,
    int_values: Vec<i64>,
    int_sum: i128,
    int_counts: BTreeMap<i64, usize>,
    bool_true: usize,
    bool_false: usize,
    string_counts: BTreeMap<String, usize>,
    other_counts: BTreeMap<String, usize>,
}

#[derive(Clone)]
struct TapPortalEvent {
    sequence: i64,
    timestamp: u64,
    label: String,
    location: String,
    value: Value,
}

#[derive(Deserialize)]
struct IncomingTapEvent {
    sequence: i64,
    timestamp: u64,
    label: String,
    location: Option<IncomingTapLocation>,
    value: Value,
}

#[derive(Deserialize)]
struct IncomingTapLocation {
    source: String,
    start: IncomingTapPosition,
}

#[derive(Deserialize)]
struct IncomingTapPosition {
    line: usize,
    col: usize,
}

fn host_state() -> &'static Mutex<HostState> {
    static STATE: OnceLock<Mutex<HostState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(HostState::default()))
}

fn clamp_color(value: i64) -> u8 {
    value.clamp(0, 255) as u8
}

fn rgb(r: i64, g: i64, b: i64) -> ffi::Color {
    ffi::Color {
        r: clamp_color(r),
        g: clamp_color(g),
        b: clamp_color(b),
        a: 255,
    }
}

fn close_window_if_open(state: &mut HostState) {
    if state.window_open {
        unsafe { ffi::CloseWindow() };
    }
    state.window_open = false;
    state.circles.clear();
    state.rects.clear();
    state.last_tap_render_ms = 0;
    state.tap_portal = None;
    state.texts.clear();
}

fn clear_scene(state: &mut HostState) {
    state.circles.clear();
    state.rects.clear();
    state.texts.clear();
}

fn sync_window_state(state: &mut HostState) {
    if state.window_open && unsafe { ffi::WindowShouldClose() } {
        unsafe { ffi::CloseWindow() };
        state.window_open = false;
        state.closed_by_user = true;
        state.circles.clear();
        state.rects.clear();
        state.texts.clear();
    }
}

fn ensure_window(state: &mut HostState) {
    let title = c"Quint + raylib";
    sync_window_state(state);
    if state.window_open {
        return;
    }

    let (width, height) = if state.tap_portal.is_some() {
        (1280, 760)
    } else {
        (800, 450)
    };

    unsafe {
        ffi::SetTraceLogLevel(ffi::TraceLogLevel::LOG_NONE as i32);
        ffi::InitWindow(width, height, title.as_ptr());
        ffi::SetTargetFPS(60);
    }
    state.window_open = true;
    state.closed_by_user = false;
}

fn render_scene(state: &mut HostState) {
    ensure_window(state);

    unsafe {
        ffi::BeginDrawing();
        ffi::ClearBackground(rgb(30, 30, 48));
    }

    if let Some(portal) = &state.tap_portal {
        render_tap_portal(portal);
        unsafe { ffi::EndDrawing() };
        maybe_take_screenshot(state);
        return;
    }

    let counter_text = CString::new(format!("Counter: {}", state.counter)).unwrap();
    unsafe {
        ffi::DrawText(counter_text.as_ptr(), 20, 20, 28, rgb(253, 249, 0));
    }

    for rect in &state.rects {
        unsafe {
            ffi::DrawRectangle(rect.x, rect.y, rect.width, rect.height, rect.color);
        }
    }
    for text in &state.texts {
        let value = CString::new(text.text.as_str()).unwrap();
        unsafe {
            ffi::DrawText(value.as_ptr(), text.x, text.y, text.font_size, text.color);
        }
    }
    for circle in &state.circles {
        unsafe {
            ffi::DrawCircle(circle.x, circle.y, circle.radius, circle.color);
        }
    }

    unsafe { ffi::EndDrawing() };
    maybe_take_screenshot(state);
}

fn maybe_take_screenshot(state: &mut HostState) {
    if !state.screenshot_taken {
        if let Some(path) = &state.screenshot_path {
            if let Ok(path_text) = CString::new(path.as_str()) {
                unsafe {
                    ffi::TakeScreenshot(path_text.as_ptr());
                }
                state.screenshot_taken = true;
            }
        }
    }
}

fn draw_text_direct(text: &str, x: i32, y: i32, font_size: i32, color: ffi::Color) {
    if let Ok(value) = CString::new(text) {
        unsafe {
            ffi::DrawText(value.as_ptr(), x, y, font_size, color);
        }
    }
}

fn draw_rect_direct(x: i32, y: i32, width: i32, height: i32, color: ffi::Color) {
    unsafe {
        ffi::DrawRectangle(x, y, width, height, color);
    }
}

fn draw_circle_direct(x: i32, y: i32, radius: i32, color: ffi::Color) {
    unsafe {
        ffi::DrawCircle(x, y, radius as f32, color);
    }
}

fn truncate_text(text: &str, max_len: usize) -> String {
    if max_len == 0 {
        return String::new();
    }
    if text.chars().count() <= max_len {
        return text.to_string();
    }
    if max_len <= 3 {
        return ".".repeat(max_len);
    }

    let mut chars = text.chars();
    let mut out = String::new();
    for _ in 0..(max_len - 3) {
        if let Some(ch) = chars.next() {
            out.push(ch);
        } else {
            return out;
        }
    }
    out.push_str("...");
    out
}

fn humanize_identifier(text: &str) -> String {
    text.replace('_', " ")
}

fn label_scope(label: &str) -> Option<String> {
    label
        .split_once('.')
        .map(|(scope, _)| humanize_identifier(scope))
}

fn label_metric(label: &str) -> String {
    humanize_identifier(
        label
            .split_once('.')
            .map(|(_, metric)| metric)
            .unwrap_or(label),
    )
}

fn compact_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let parts = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if parts.len() <= 3 {
        return normalized;
    }
    format!(".../{}", parts[parts.len() - 3..].join("/"))
}

fn itf_int_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => map
            .get("#bigint")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        _ => None,
    }
}

fn itf_int(value: Option<&Value>) -> Option<i64> {
    itf_int_text(value).and_then(|text| text.parse::<i64>().ok())
}

fn map_entries<'a>(value: &'a Value) -> Vec<(&'a Value, &'a Value)> {
    match value {
        Value::Object(record) => record
            .get("#map")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| {
                        let pair = entry.as_array()?;
                        if pair.len() == 2 {
                            Some((&pair[0], &pair[1]))
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Bool(flag) => {
            if *flag {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        Value::Number(number) => number.to_string(),
        Value::Object(record) => record
            .get("#bigint")
            .and_then(Value::as_str)
            .map(|text| text.to_string())
            .unwrap_or_else(|| value.to_string()),
        _ => value.to_string(),
    }
}

fn map_keys(value: &Value) -> Vec<String> {
    map_entries(value)
        .into_iter()
        .map(|(key, _)| value_text(key))
        .collect()
}

fn map_get<'a>(value: &'a Value, wanted: &str) -> Option<&'a Value> {
    map_entries(value)
        .into_iter()
        .find_map(|(key, entry_value)| (value_text(key) == wanted).then_some(entry_value))
}

fn looks_like_bank_tap(value: &Value) -> bool {
    matches!(value, Value::Object(record) if record.contains_key("balances") && record.contains_key("supply") && record.contains_key("last"))
}

fn balance_amount(balances: &Value, addr: &str, denom: &str) -> i64 {
    map_get(balances, addr)
        .and_then(|account| map_get(account, denom))
        .and_then(|value| itf_int(Some(value)))
        .unwrap_or(0)
}

fn location_text(location: &Option<IncomingTapLocation>) -> String {
    location
        .as_ref()
        .map(|loc| {
            format!(
                "{}:{}:{}",
                compact_path(&loc.source),
                loc.start.line + 1,
                loc.start.col + 1
            )
        })
        .unwrap_or_else(|| "no source location".to_string())
}

fn convert_tap_event(event: IncomingTapEvent) -> TapPortalEvent {
    TapPortalEvent {
        sequence: event.sequence,
        timestamp: event.timestamp,
        label: event.label.clone(),
        location: location_text(&event.location),
        value: event.value.clone(),
    }
}

fn increment_count(counts: &mut BTreeMap<String, usize>, key: String) {
    *counts.entry(key).or_insert(0) += 1;
}

fn update_label_stats(stats: &mut TapLabelStats, event: &TapPortalEvent) {
    if stats.location.is_empty() {
        stats.location = event.location.clone();
    }
    stats.sample_count += 1;

    if let Some(int_value) = itf_int(Some(&event.value)) {
        stats.int_values.push(int_value);
        stats.int_sum += i128::from(int_value);
        *stats.int_counts.entry(int_value).or_insert(0) += 1;
        return;
    }

    if let Some(flag) = event.value.as_bool() {
        if flag {
            stats.bool_true += 1;
        } else {
            stats.bool_false += 1;
        }
        return;
    }

    if let Some(text) = event.value.as_str() {
        increment_count(&mut stats.string_counts, truncate_text(text, 36));
        return;
    }

    increment_count(
        &mut stats.other_counts,
        truncate_text(
            &serde_json::to_string(&event.value).unwrap_or_else(|_| event.value.to_string()),
            36,
        ),
    );
}

fn percentile_i64(sorted: &[i64], quantile: f64) -> i64 {
    let index = ((sorted.len() as f64 * quantile).ceil() as usize)
        .saturating_sub(1)
        .min(sorted.len().saturating_sub(1));
    sorted[index]
}

fn average_i64(sum: i128, count: usize) -> f64 {
    if count == 0 {
        0.0
    } else {
        sum as f64 / count as f64
    }
}

fn top_count_entries(counts: &BTreeMap<String, usize>, limit: usize) -> Vec<(String, usize)> {
    let mut entries = counts
        .iter()
        .map(|(value, count)| (value.clone(), *count))
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    entries.truncate(limit);
    entries
}

fn numeric_bars(stats: &TapLabelStats, max_bars: usize) -> Vec<(String, usize)> {
    if stats.int_counts.is_empty() {
        return Vec::new();
    }

    let min = *stats.int_counts.keys().next().unwrap();
    let max = *stats.int_counts.keys().last().unwrap();
    if stats.int_counts.len() <= max_bars && max - min <= 24 {
        return stats
            .int_counts
            .iter()
            .map(|(value, count)| (value.to_string(), *count))
            .collect();
    }

    let bin_count = max_bars.max(1).min(8);
    let span = (max - min + 1).max(bin_count as i64);
    let bin_width = ((span + bin_count as i64 - 1) / bin_count as i64).max(1);
    let mut bins = vec![0usize; bin_count];

    for (value, count) in &stats.int_counts {
        let index = (((*value - min) / bin_width) as usize).min(bin_count - 1);
        bins[index] += *count;
    }

    bins.into_iter()
        .enumerate()
        .filter(|(_, count)| *count > 0)
        .map(|(index, count)| {
            let start = min + index as i64 * bin_width;
            let end = (start + bin_width - 1).min(max);
            let label = if start == end {
                start.to_string()
            } else {
                format!("{start}..{end}")
            };
            (label, count)
        })
        .collect()
}

fn categorical_bars(stats: &TapLabelStats) -> Vec<(String, usize)> {
    if stats.bool_true + stats.bool_false > 0 {
        let mut entries = Vec::new();
        if stats.bool_true > 0 {
            entries.push(("true".to_string(), stats.bool_true));
        }
        if stats.bool_false > 0 {
            entries.push(("false".to_string(), stats.bool_false));
        }
        return entries;
    }

    if !stats.string_counts.is_empty() {
        return top_count_entries(&stats.string_counts, 5);
    }

    top_count_entries(&stats.other_counts, 5)
}

fn label_overview_text(stats: &TapLabelStats) -> String {
    if !stats.int_values.is_empty() {
        let min = *stats.int_values.iter().min().unwrap_or(&0);
        let max = *stats.int_values.iter().max().unwrap_or(&0);
        let avg = average_i64(stats.int_sum, stats.int_values.len());
        return format!("range {min}..{max}  avg {avg:.1}");
    }

    if stats.bool_true + stats.bool_false > 0 {
        return format!("true {}  false {}", stats.bool_true, stats.bool_false);
    }

    let distinct = if !stats.string_counts.is_empty() {
        stats.string_counts.len()
    } else {
        stats.other_counts.len()
    };
    format!("distinct values {distinct}")
}

fn render_vertical_bars(
    entries: &[(String, usize)],
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    color: ffi::Color,
) {
    if entries.is_empty() || width <= 0 || height <= 0 {
        return;
    }

    let label_height = 22;
    let bar_height = (height - label_height).max(24);
    let gap = 8;
    let total_gap = gap * (entries.len().saturating_sub(1) as i32);
    let bar_width = ((width - total_gap) / entries.len() as i32).max(16);
    let max_count = entries.iter().map(|(_, count)| *count).max().unwrap_or(1) as f32;

    for (index, (label, count)) in entries.iter().enumerate() {
        let left = x + index as i32 * (bar_width + gap);
        let draw_height = ((*count as f32 / max_count) * (bar_height - 18) as f32).round() as i32;
        draw_rect_direct(
            left,
            y + bar_height - draw_height,
            bar_width,
            draw_height,
            color,
        );
        draw_text_direct(
            &count.to_string(),
            left,
            y + bar_height - draw_height - 18,
            14,
            rgb(235, 235, 235),
        );
        draw_text_direct(
            &truncate_text(label, 10),
            left,
            y + bar_height + 2,
            14,
            rgb(210, 210, 210),
        );
    }
}

fn render_horizontal_bars(
    entries: &[(String, usize)],
    x: i32,
    y: i32,
    width: i32,
    color: ffi::Color,
) {
    if entries.is_empty() || width <= 0 {
        return;
    }

    let max_count = entries.iter().map(|(_, count)| *count).max().unwrap_or(1) as f32;
    for (index, (label, count)) in entries.iter().enumerate() {
        let top = y + index as i32 * 24;
        draw_text_direct(&truncate_text(label, 18), x, top, 16, rgb(235, 235, 235));
        let bar_width = ((*count as f32 / max_count) * (width - 140) as f32).round() as i32;
        draw_rect_direct(x + 124, top + 2, bar_width.max(2), 14, color);
        draw_text_direct(
            &count.to_string(),
            x + width - 32,
            top,
            16,
            rgb(235, 235, 235),
        );
    }
}

fn render_stats_card(
    label: &str,
    stats: &TapLabelStats,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    highlight: bool,
) {
    let title = label_metric(label);
    let scope = label_scope(label);

    draw_rect_direct(
        x,
        y,
        width,
        height,
        if highlight {
            rgb(46, 67, 108)
        } else {
            rgb(28, 34, 46)
        },
    );

    draw_text_direct(
        &truncate_text(&title, 30),
        x + 12,
        y + 10,
        18,
        rgb(255, 255, 255),
    );
    if let Some(scope) = scope {
        draw_text_direct(
            &truncate_text(&scope, 32),
            x + 12,
            y + 32,
            14,
            rgb(170, 170, 170),
        );
    }
    draw_text_direct(
        &truncate_text(&stats.location, 40),
        x + 12,
        y + 50,
        13,
        rgb(165, 165, 165),
    );
    draw_text_direct(
        &format!("samples {}", stats.sample_count),
        x + 12,
        y + 68,
        14,
        rgb(210, 210, 210),
    );

    if !stats.int_values.is_empty() {
        let mut sorted = stats.int_values.clone();
        sorted.sort_unstable();
        let min = *sorted.first().unwrap();
        let max = *sorted.last().unwrap();
        let p90 = percentile_i64(&sorted, 0.9);
        let avg = average_i64(stats.int_sum, stats.int_values.len());
        draw_text_direct(
            &format!("min {min}  avg {avg:.2}  p90 {p90}  max {max}"),
            x + 12,
            y + 88,
            15,
            rgb(255, 255, 255),
        );
        render_vertical_bars(
            &numeric_bars(stats, 8),
            x + 12,
            y + 108,
            width - 24,
            height - 120,
            rgb(0, 121, 241),
        );
        return;
    }

    let entries = categorical_bars(stats);
    let distinct = if stats.bool_true + stats.bool_false > 0 {
        usize::from(stats.bool_true > 0) + usize::from(stats.bool_false > 0)
    } else if !stats.string_counts.is_empty() {
        stats.string_counts.len()
    } else {
        stats.other_counts.len()
    };
    draw_text_direct(
        &format!("distinct values {distinct}"),
        x + 12,
        y + 88,
        15,
        rgb(255, 255, 255),
    );
    render_horizontal_bars(&entries, x + 12, y + 108, width - 24, rgb(0, 200, 120));
}

fn render_tap_portal(portal: &TapPortalState) {
    let Some(current) = portal.latest_event.as_ref() else {
        return;
    };

    if looks_like_bank_tap(&current.value) {
        render_bank_tap(portal, current);
    } else {
        render_generic_tap(portal);
    }
}

fn render_generic_tap(portal: &TapPortalState) {
    draw_text_direct("Quint live statistics", 20, 20, 30, rgb(255, 255, 255));
    draw_text_direct(
        "Stable cumulative summaries rendered by the native raylib listener",
        20,
        56,
        16,
        rgb(180, 180, 180),
    );
    draw_text_direct(
        &format!(
            "tap samples {}  metrics {}",
            portal.total_events,
            portal.stats_by_label.len(),
        ),
        20,
        84,
        18,
        rgb(255, 255, 255),
    );
    draw_text_direct(
        "Text stays fixed while the cumulative distributions fill in over time.",
        20,
        102,
        15,
        rgb(190, 190, 190),
    );

    draw_rect_direct(18, 132, 320, 604, rgb(28, 34, 46));
    draw_text_direct("tracked metrics", 30, 144, 22, rgb(255, 255, 255));

    let mut metric_rows = portal
        .stats_by_label
        .iter()
        .map(|(label, stats)| (label.as_str(), stats))
        .collect::<Vec<_>>();
    metric_rows.sort_by(|left, right| left.0.cmp(right.0));

    for (index, (label, stats)) in metric_rows.iter().take(12).enumerate() {
        let line_y = 180 + index as i32 * 44;
        let metric = humanize_identifier(&label.replace('.', " / "));
        draw_text_direct(
            &truncate_text(&metric, 22),
            30,
            line_y,
            17,
            rgb(255, 255, 255),
        );
        draw_text_direct(
            &truncate_text(&stats.location, 28),
            30,
            line_y + 18,
            13,
            rgb(165, 165, 165),
        );
        draw_text_direct(
            &format!("samples {}", stats.sample_count),
            220,
            line_y,
            14,
            rgb(210, 210, 210),
        );
        draw_text_direct(
            &truncate_text(&label_overview_text(stats), 16),
            220,
            line_y + 18,
            13,
            rgb(165, 165, 165),
        );
    }

    if portal.stats_by_label.len() > 12 {
        draw_text_direct(
            &format!("showing first 12 of {} metrics", portal.stats_by_label.len()),
            30,
            712,
            14,
            rgb(165, 165, 165),
        );
    }

    draw_rect_direct(356, 132, 900, 76, rgb(28, 34, 46));
    draw_text_direct("running summaries", 368, 144, 22, rgb(255, 255, 255));
    draw_text_direct(
        "Cards stay alphabetized and only show cumulative summaries, not the latest event payload.",
        368,
        174,
        15,
        rgb(185, 185, 185),
    );

    let mut labels = portal
        .stats_by_label
        .iter()
        .map(|(label, stats)| (label.as_str(), stats))
        .collect::<Vec<_>>();
    labels.sort_by(|left, right| left.0.cmp(right.0));

    for (index, (label, stats)) in labels.into_iter().take(6).enumerate() {
        let column = index % 2;
        let row = index / 2;
        let card_x = 356 + column as i32 * 450;
        let card_y = 228 + row as i32 * 158;
        render_stats_card(label, stats, card_x, card_y, 430, 146, false);
    }
}

fn render_bank_tap(portal: &TapPortalState, current: &TapPortalEvent) {
    let Value::Object(record) = &current.value else {
        render_generic_tap(portal);
        return;
    };
    let Some(last) = record.get("last").and_then(Value::as_object) else {
        render_generic_tap(portal);
        return;
    };

    let supply = record.get("supply").unwrap_or(&Value::Null);
    let balances = record.get("balances").unwrap_or(&Value::Null);
    let addresses = map_keys(balances);
    let denoms = map_keys(supply);

    let max_balance = addresses
        .iter()
        .flat_map(|addr| {
            denoms
                .iter()
                .map(move |denom| balance_amount(balances, addr, denom))
        })
        .max()
        .unwrap_or(1)
        .max(1);
    let scale = if max_balance <= 140 {
        1
    } else {
        ((max_balance as f64) / 140.0).ceil() as i64
    };

    draw_text_direct(
        &format!("tap #{}", current.sequence),
        320,
        20,
        28,
        rgb(255, 255, 255),
    );
    draw_text_direct(&current.label, 320, 48, 18, rgb(200, 200, 200));
    draw_text_direct(&current.location, 320, 68, 14, rgb(180, 180, 180));
    if let Some(tick) = itf_int_text(record.get("tick")) {
        draw_text_direct(&format!("tick {tick}"), 320, 88, 22, rgb(255, 255, 255));
    }
    if let Some(successes) = itf_int_text(record.get("successes")) {
        draw_text_direct(
            &format!("successes {successes}"),
            320,
            120,
            18,
            rgb(0, 228, 48),
        );
    }
    if let Some(failures) = itf_int_text(record.get("failures")) {
        draw_text_direct(
            &format!("failures {failures}"),
            320,
            144,
            18,
            rgb(230, 41, 55),
        );
    }

    let from = last
        .get("from")
        .map(value_text)
        .unwrap_or_else(|| "?".to_string());
    let to = last
        .get("to")
        .map(value_text)
        .unwrap_or_else(|| "?".to_string());
    let denom = last
        .get("denom")
        .map(value_text)
        .unwrap_or_else(|| "?".to_string());
    let amount = itf_int_text(last.get("amount")).unwrap_or_else(|| "0".to_string());
    let ok = last.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let error = last.get("error").and_then(Value::as_str).unwrap_or("");
    let error_text = if error.is_empty() {
        "last error: none".to_string()
    } else {
        format!("last error: {}", truncate_text(error, 30))
    };

    draw_text_direct(
        &format!("last {from} -> {to}"),
        320,
        176,
        20,
        rgb(255, 255, 255),
    );
    draw_text_direct(
        &format!("amount {amount} {denom}"),
        320,
        202,
        18,
        rgb(255, 255, 255),
    );
    draw_text_direct(
        if ok {
            "last transfer succeeded"
        } else {
            "last transfer failed"
        },
        320,
        226,
        18,
        if ok {
            rgb(0, 228, 48)
        } else {
            rgb(230, 41, 55)
        },
    );
    draw_text_direct(&error_text, 320, 250, 16, rgb(200, 200, 200));

    for (index, denom_name) in denoms.iter().take(2).enumerate() {
        let color = if index == 0 {
            rgb(253, 249, 0)
        } else {
            rgb(230, 41, 55)
        };
        let supply_text =
            itf_int_text(map_get(supply, denom_name)).unwrap_or_else(|| "0".to_string());
        draw_text_direct(
            &format!("{denom_name} supply {supply_text}"),
            620,
            92 + index as i32 * 24,
            18,
            color,
        );
    }

    draw_text_direct("balances", 320, 274, 22, rgb(255, 255, 255));

    for (index, addr) in addresses.iter().enumerate() {
        let left = 340 + index as i32 * 150;
        draw_text_direct(addr, left, 304, 18, rgb(255, 255, 255));
        for (denom_index, denom_name) in denoms.iter().take(2).enumerate() {
            let amount = balance_amount(balances, addr, denom_name);
            let height = ((amount as f64) / (scale as f64)).floor().clamp(0.0, 140.0) as i32;
            let x = left + denom_index as i32 * 44;
            let color = if denom_index == 0 {
                rgb(253, 249, 0)
            } else {
                rgb(230, 41, 55)
            };
            draw_rect_direct(x, 450 - height, 28, height, color);
            draw_text_direct(
                &truncate_text(&format!("{denom_name}: {amount}"), 14),
                left - 6,
                456 + denom_index as i32 * 18,
                14,
                color,
            );
        }
        if from == *addr {
            draw_circle_direct(left + 4, 290, 6, rgb(255, 161, 0));
        }
        if to == *addr {
            draw_circle_direct(left + 28, 290, 6, rgb(0, 228, 48));
        }
    }
}

fn maybe_render(state: &mut HostState) {
    if !state.batching {
        render_scene(state);
    }
}

fn maybe_render_tap(state: &mut HostState, timestamp: u64) {
    if state.batching {
        return;
    }
    if state.last_tap_render_ms == 0
        || timestamp.saturating_sub(state.last_tap_render_ms) >= state.tap_render_interval_ms
    {
        render_scene(state);
        state.last_tap_render_ms = timestamp;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn show_hello_window_host(frames: i64) -> i64 {
    let total_frames = frames.max(1).min(i64::from(i32::MAX)) as i32;

    let mut state = host_state().lock().unwrap();
    close_window_if_open(&mut state);
    state.counter = 0;
    state.texts.push(TextCommand {
        text: "Hello from Quint foreign bindings".to_string(),
        x: 120,
        y: 120,
        font_size: 30,
        color: rgb(255, 255, 255),
    });
    state.circles.push(CircleCommand {
        x: 400,
        y: 280,
        radius: 70.0,
        color: rgb(0, 121, 241),
    });
    render_scene(&mut state);
    drop(state);

    for frame in 0..total_frames {
        let mut state = host_state().lock().unwrap();
        sync_window_state(&mut state);
        if state.closed_by_user {
            break;
        }
        state.counter = i64::from(frame);
        render_scene(&mut state);
        drop(state);
        thread::sleep(Duration::from_millis(16));
    }

    let mut state = host_state().lock().unwrap();
    close_window_if_open(&mut state);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_set_counter_host(value: i64) -> i64 {
    let mut state = host_state().lock().unwrap();
    state.counter = value;
    maybe_render(&mut state);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_clear_scene_host() -> i64 {
    let mut state = host_state().lock().unwrap();
    clear_scene(&mut state);
    maybe_render(&mut state);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_begin_frame_host() -> i64 {
    let mut state = host_state().lock().unwrap();
    ensure_window(&mut state);
    state.batching = true;
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_end_frame_host() -> i64 {
    let mut state = host_state().lock().unwrap();
    render_scene(&mut state);
    state.batching = false;
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_draw_text_host(
    text: *const c_char,
    x: i64,
    y: i64,
    font_size: i64,
    r: i64,
    g: i64,
    b: i64,
) -> i64 {
    if text.is_null() {
        return -1;
    }

    let mut state = host_state().lock().unwrap();
    let text = unsafe { CStr::from_ptr(text) }
        .to_string_lossy()
        .into_owned();
    state.texts.push(TextCommand {
        text,
        x: x as i32,
        y: y as i32,
        font_size: font_size.max(1).min(i64::from(i32::MAX)) as i32,
        color: rgb(r, g, b),
    });
    maybe_render(&mut state);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_draw_text_int_host(
    prefix: *const c_char,
    value: i64,
    x: i64,
    y: i64,
    font_size: i64,
    r: i64,
    g: i64,
    b: i64,
) -> i64 {
    if prefix.is_null() {
        return -1;
    }

    let mut state = host_state().lock().unwrap();
    let prefix = unsafe { CStr::from_ptr(prefix) }
        .to_string_lossy()
        .into_owned();
    state.texts.push(TextCommand {
        text: format!("{prefix}{value}"),
        x: x as i32,
        y: y as i32,
        font_size: font_size.max(1).min(i64::from(i32::MAX)) as i32,
        color: rgb(r, g, b),
    });
    maybe_render(&mut state);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_draw_circle_host(
    x: i64,
    y: i64,
    radius: i64,
    r: i64,
    g: i64,
    b: i64,
) -> i64 {
    let mut state = host_state().lock().unwrap();
    state.circles.push(CircleCommand {
        x: x as i32,
        y: y as i32,
        radius: radius.max(0) as f32,
        color: rgb(r, g, b),
    });
    maybe_render(&mut state);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_draw_rect_host(
    x: i64,
    y: i64,
    width: i64,
    height: i64,
    r: i64,
    g: i64,
    b: i64,
) -> i64 {
    let mut state = host_state().lock().unwrap();
    state.rects.push(RectCommand {
        x: x as i32,
        y: y as i32,
        width: width.max(0).min(i64::from(i32::MAX)) as i32,
        height: height.max(0).min(i64::from(i32::MAX)) as i32,
        color: rgb(r, g, b),
    });
    maybe_render(&mut state);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_sleep_millis_host(milliseconds: i64) -> i64 {
    thread::sleep(Duration::from_millis(milliseconds.max(0) as u64));
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_window_should_close_host() -> bool {
    let mut state = host_state().lock().unwrap();
    sync_window_state(&mut state);
    state.closed_by_user
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_is_key_pressed_host(key: i64) -> bool {
    let mut state = host_state().lock().unwrap();
    sync_window_state(&mut state);
    if !state.window_open {
        return false;
    }
    unsafe { ffi::IsKeyPressed(key as i32) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_close_window_host() -> i64 {
    let mut state = host_state().lock().unwrap();
    close_window_if_open(&mut state);
    state.closed_by_user = false;
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_tap_portal_listener_host(event_json: *const c_char) -> bool {
    if event_json.is_null() {
        return false;
    }

    let text = unsafe { CStr::from_ptr(event_json) }
        .to_string_lossy()
        .into_owned();
    let Ok(event) = serde_json::from_str::<IncomingTapEvent>(&text) else {
        return false;
    };

    let mut state = host_state().lock().unwrap();
    let converted = convert_tap_event(event);
    let event_count = {
        let portal = state.tap_portal.get_or_insert_with(|| TapPortalState {
            latest_event: None,
            total_events: 0,
            stats_by_label: BTreeMap::new(),
        });
        portal.total_events += 1;
        let stats = portal
            .stats_by_label
            .entry(converted.label.clone())
            .or_insert_with(TapLabelStats::default);
        update_label_stats(stats, &converted);
        portal.latest_event = Some(converted.clone());
        portal.total_events
    };
    let delay_ms = state.tap_delay_ms;
    let timestamp = converted.timestamp;
    state.counter = event_count as i64;
    maybe_render_tap(&mut state, timestamp);
    drop(state);
    if delay_ms > 0 {
        thread::sleep(Duration::from_millis(delay_ms));
    }
    true
}
