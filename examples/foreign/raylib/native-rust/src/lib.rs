use raylib::ffi;
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

struct HostState {
    window_open: bool,
    closed_by_user: bool,
    counter: i64,
    circles: Vec<CircleCommand>,
    texts: Vec<TextCommand>,
}

impl Default for HostState {
    fn default() -> Self {
        Self {
            window_open: false,
            closed_by_user: false,
            counter: 0,
            circles: Vec::new(),
            texts: Vec::new(),
        }
    }
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
    state.texts.clear();
}

fn sync_window_state(state: &mut HostState) {
    if state.window_open && unsafe { ffi::WindowShouldClose() } {
        unsafe { ffi::CloseWindow() };
        state.window_open = false;
        state.closed_by_user = true;
        state.circles.clear();
        state.texts.clear();
    }
}

fn ensure_window(state: &mut HostState) {
    let title = c"Quint + raylib";
    sync_window_state(state);
    if state.window_open {
        return;
    }

    unsafe {
        ffi::SetTraceLogLevel(ffi::TraceLogLevel::LOG_NONE as i32);
        ffi::InitWindow(800, 450, title.as_ptr());
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

    let counter_text = CString::new(format!("Counter: {}", state.counter)).unwrap();
    unsafe {
        ffi::DrawText(counter_text.as_ptr(), 20, 20, 28, rgb(253, 249, 0));
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
    render_scene(&mut state);
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
    render_scene(&mut state);
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
    render_scene(&mut state);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_window_should_close_host() -> bool {
    let mut state = host_state().lock().unwrap();
    sync_window_state(&mut state);
    state.closed_by_user
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_close_window_host() -> i64 {
    let mut state = host_state().lock().unwrap();
    close_window_if_open(&mut state);
    state.closed_by_user = false;
    0
}
