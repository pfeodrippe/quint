use raylib::ffi;
use serde::Deserialize;
use serde_json::Value;
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
            tap_portal: None,
            texts: Vec::new(),
        }
    }
}

#[derive(Clone)]
struct TapPortalState {
    events: Vec<TapPortalEvent>,
}

#[derive(Clone)]
struct TapPortalEvent {
    sequence: i64,
    backend: String,
    label: String,
    location: String,
    summary: String,
    value: Value,
    stats: Vec<String>,
    detail_lines: Vec<String>,
}

#[derive(Deserialize)]
struct IncomingTapEvent {
    sequence: i64,
    backend: String,
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
        (1000, 520)
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
    let mut chars = text.chars();
    let mut out = String::new();
    for _ in 0..max_len {
        if let Some(ch) = chars.next() {
            out.push(ch);
        } else {
            return out;
        }
    }
    if chars.next().is_some() {
        out.pop();
        out.push('…');
    }
    out
}

fn wrap_text(text: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        let next = if current.is_empty() {
            word.to_string()
        } else {
            format!("{current} {word}")
        };
        if next.chars().count() <= width {
            current = next;
        } else {
            if !current.is_empty() {
                lines.push(current);
            }
            current = word.to_string();
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

fn itf_int_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => map.get("#bigint").and_then(|v| v.as_str()).map(|s| s.to_string()),
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
        .map(|loc| format!("{}:{}:{}", loc.source, loc.start.line + 1, loc.start.col + 1))
        .unwrap_or_else(|| "no source location".to_string())
}

fn build_summary(sequence: i64, label: &str, value: &Value) -> String {
    if let Value::Object(record) = value {
        if let Some(tick) = itf_int_text(record.get("tick")) {
            let verdict = record
                .get("last")
                .and_then(Value::as_object)
                .and_then(|last| last.get("ok"))
                .and_then(Value::as_bool)
                .map(|ok| if ok { "ok" } else { "err" })
                .unwrap_or("tap");
            return format!("#{sequence} {} t={tick} {verdict}", truncate_text(label, 18));
        }
    }
    format!("#{sequence} {}", truncate_text(label, 26))
}

fn build_stats(value: &Value) -> Vec<String> {
    let mut stats = Vec::new();
    let Value::Object(record) = value else {
        return stats;
    };

    if let Some(tick) = itf_int_text(record.get("tick")) {
        stats.push(format!("tick {tick}"));
    }
    if let Some(successes) = itf_int_text(record.get("successes")) {
        stats.push(format!("successes {successes}"));
    }
    if let Some(failures) = itf_int_text(record.get("failures")) {
        stats.push(format!("failures {failures}"));
    }
    if let Some(last) = record.get("last").and_then(Value::as_object) {
        let from = last.get("from").and_then(Value::as_str).unwrap_or("?");
        let to = last.get("to").and_then(Value::as_str).unwrap_or("?");
        let denom = last.get("denom").and_then(Value::as_str).unwrap_or("?");
        let amount = itf_int_text(last.get("amount")).unwrap_or_else(|| "0".to_string());
        let outcome = last
            .get("ok")
            .and_then(Value::as_bool)
            .map(|ok| if ok { "ok" } else { "err" })
            .unwrap_or("tap");
        stats.push(format!("last {from} -> {to}  {amount} {denom}  {outcome}"));
        if let Some(error) = last.get("error").and_then(Value::as_str) {
            if !error.is_empty() {
                stats.push(format!("error {}", truncate_text(error, 52)));
            }
        }
    }
    stats
}

fn detail_lines(value: &Value) -> Vec<String> {
    let pretty = serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string());
    pretty.lines().flat_map(|line| wrap_text(line, 56)).collect()
}

fn convert_tap_event(event: IncomingTapEvent) -> TapPortalEvent {
    TapPortalEvent {
        sequence: event.sequence,
        backend: event.backend,
        label: event.label.clone(),
        location: location_text(&event.location),
        summary: build_summary(event.sequence, &event.label, &event.value),
        value: event.value.clone(),
        stats: build_stats(&event.value),
        detail_lines: detail_lines(&event.value),
    }
}

fn render_tap_portal(portal: &TapPortalState) {
    let Some(current) = portal.events.last() else {
        return;
    };

    draw_text_direct("Quint q::tap native listener", 20, 20, 28, rgb(255, 255, 255));
    draw_text_direct(
        "Rust raylib host rendering direct FFI tap events",
        20,
        54,
        16,
        rgb(180, 180, 180),
    );
    draw_text_direct(
        &format!("events {}", portal.events.len()),
        20,
        82,
        18,
        rgb(255, 255, 255),
    );

    draw_rect_direct(18, 112, 430, 330, rgb(28, 34, 46));
    draw_text_direct("recent taps", 28, 122, 22, rgb(255, 255, 255));

    let recent = portal.events.iter().rev().take(14).collect::<Vec<_>>();
    for (index, event) in recent.iter().rev().enumerate() {
        let y = 156 + index as i32 * 20;
        if event.sequence == current.sequence {
            draw_rect_direct(24, y - 2, 416, 18, rgb(56, 107, 214));
        }
        draw_text_direct(&truncate_text(&event.summary, 40), 30, y, 16, rgb(255, 255, 255));
    }

    if looks_like_bank_tap(&current.value) {
        render_bank_tap(current);
    } else {
        render_generic_tap(current);
    }
}

fn render_generic_tap(current: &TapPortalEvent) {
    draw_rect_direct(470, 112, 500, 330, rgb(28, 34, 46));
    draw_text_direct("latest tap", 480, 122, 22, rgb(255, 255, 255));
    draw_text_direct(&current.label, 480, 154, 20, rgb(255, 255, 255));
    draw_text_direct(&current.location, 480, 182, 14, rgb(180, 180, 180));
    draw_text_direct(
        &format!("backend {}  sequence {}", current.backend, current.sequence),
        480,
        206,
        16,
        rgb(200, 200, 200),
    );

    for (index, stat) in current.stats.iter().take(4).enumerate() {
        draw_text_direct(stat, 480, 236 + index as i32 * 22, 18, rgb(255, 255, 255));
    }

    let detail_start = 236 + (current.stats.len().min(4) as i32) * 22 + 16;
    for (index, line) in current.detail_lines.iter().take(8).enumerate() {
        draw_text_direct(line, 480, detail_start + index as i32 * 18, 16, rgb(220, 220, 220));
    }
}

fn render_bank_tap(current: &TapPortalEvent) {
    let Value::Object(record) = &current.value else {
        render_generic_tap(current);
        return;
    };
    let Some(last) = record.get("last").and_then(Value::as_object) else {
        render_generic_tap(current);
        return;
    };

    let supply = record.get("supply").unwrap_or(&Value::Null);
    let balances = record.get("balances").unwrap_or(&Value::Null);
    let addresses = map_keys(balances);
    let denoms = map_keys(supply);

    let max_balance = addresses
        .iter()
        .flat_map(|addr| denoms.iter().map(move |denom| balance_amount(balances, addr, denom)))
        .max()
        .unwrap_or(1)
        .max(1);
    let scale = if max_balance <= 140 {
        1
    } else {
        ((max_balance as f64) / 140.0).ceil() as i64
    };

    draw_text_direct(&format!("tap #{}", current.sequence), 320, 20, 28, rgb(255, 255, 255));
    draw_text_direct(&current.label, 320, 48, 18, rgb(200, 200, 200));
    draw_text_direct(&current.location, 320, 68, 14, rgb(180, 180, 180));
    if let Some(tick) = itf_int_text(record.get("tick")) {
        draw_text_direct(&format!("tick {tick}"), 320, 88, 22, rgb(255, 255, 255));
    }
    if let Some(successes) = itf_int_text(record.get("successes")) {
        draw_text_direct(&format!("successes {successes}"), 320, 120, 18, rgb(0, 228, 48));
    }
    if let Some(failures) = itf_int_text(record.get("failures")) {
        draw_text_direct(&format!("failures {failures}"), 320, 144, 18, rgb(230, 41, 55));
    }

    let from = last.get("from").map(value_text).unwrap_or_else(|| "?".to_string());
    let to = last.get("to").map(value_text).unwrap_or_else(|| "?".to_string());
    let denom = last.get("denom").map(value_text).unwrap_or_else(|| "?".to_string());
    let amount = itf_int_text(last.get("amount")).unwrap_or_else(|| "0".to_string());
    let ok = last.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let error = last.get("error").and_then(Value::as_str).unwrap_or("");
    let error_text = if error.is_empty() {
        "last error: none".to_string()
    } else {
        format!("last error: {}", truncate_text(error, 30))
    };

    draw_text_direct(&format!("last {from} -> {to}"), 320, 176, 20, rgb(255, 255, 255));
    draw_text_direct(&format!("amount {amount} {denom}"), 320, 202, 18, rgb(255, 255, 255));
    draw_text_direct(
        if ok {
            "last transfer succeeded"
        } else {
            "last transfer failed"
        },
        320,
        226,
        18,
        if ok { rgb(0, 228, 48) } else { rgb(230, 41, 55) },
    );
    draw_text_direct(&error_text, 320, 250, 16, rgb(200, 200, 200));

    for (index, denom_name) in denoms.iter().take(2).enumerate() {
        let color = if index == 0 { rgb(253, 249, 0) } else { rgb(230, 41, 55) };
        let supply_text = itf_int_text(map_get(supply, denom_name)).unwrap_or_else(|| "0".to_string());
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
            let color = if denom_index == 0 { rgb(253, 249, 0) } else { rgb(230, 41, 55) };
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
    let portal = state
        .tap_portal
        .get_or_insert_with(|| TapPortalState { events: Vec::new() });
    portal.events.push(convert_tap_event(event));
    if portal.events.len() > 200 {
        let excess = portal.events.len() - 200;
        portal.events.drain(0..excess);
    }
    state.counter = portal.events.len() as i64;
    maybe_render(&mut state);
    true
}
