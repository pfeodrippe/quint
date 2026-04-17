use raylib::ffi;
use std::ffi::{c_char, CStr, CString};
use std::sync::{Mutex, OnceLock};

struct CircleCommand {
    x: i32,
    y: i32,
    radius: f32,
    color: ffi::Color,
}

struct TextCommand {
    text: String,
    x: i32,
    y: i32,
    font_size: i32,
    color: ffi::Color,
}

struct HostState {
    window_open: bool,
    counter: i64,
    queued_circles: Vec<CircleCommand>,
    queued_texts: Vec<TextCommand>,
}

impl Default for HostState {
    fn default() -> Self {
        Self {
            window_open: false,
            counter: 0,
            queued_circles: Vec::new(),
            queued_texts: Vec::new(),
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

fn ensure_window(state: &mut HostState) {
    if state.window_open {
        return;
    }

    let title = c"Quint + raylib";
    unsafe {
        ffi::InitWindow(800, 450, title.as_ptr());
        ffi::SetTargetFPS(60);
    }
    state.window_open = true;
}

fn close_window_if_open(state: &mut HostState) {
    if state.window_open {
        unsafe { ffi::CloseWindow() };
        state.window_open = false;
    }
    state.queued_circles.clear();
    state.queued_texts.clear();
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn show_hello_window_host(frames: i64) -> i64 {
    let total_frames = frames.max(1).min(i64::from(i32::MAX)) as i32;

    let mut state = host_state().lock().unwrap();
    close_window_if_open(&mut state);
    ensure_window(&mut state);

    for frame in 0..total_frames {
        if unsafe { ffi::WindowShouldClose() } {
            break;
        }

        state.counter = i64::from(frame);
        state.queued_texts.push(TextCommand {
            text: "Hello from Quint foreign bindings".to_string(),
            x: 120,
            y: 120,
            font_size: 30,
            color: rgb(255, 255, 255),
        });
        state.queued_circles.push(CircleCommand {
            x: 400,
            y: 280,
            radius: 70.0,
            color: rgb(0, 121, 241),
        });

        unsafe {
            ffi::BeginDrawing();
            ffi::ClearBackground(rgb(30, 30, 48));
        }

        let counter_text = CString::new(format!("Counter: {}", state.counter)).unwrap();
        unsafe {
            ffi::DrawText(counter_text.as_ptr(), 20, 20, 28, rgb(253, 249, 0));
        }

        for text in &state.queued_texts {
            let text_value = CString::new(text.text.as_str()).unwrap();
            unsafe {
                ffi::DrawText(text_value.as_ptr(), text.x, text.y, text.font_size, text.color);
            }
        }
        for circle in &state.queued_circles {
            unsafe {
                ffi::DrawCircle(circle.x, circle.y, circle.radius, circle.color);
            }
        }

        unsafe { ffi::EndDrawing() };
        state.queued_texts.clear();
        state.queued_circles.clear();
    }

    close_window_if_open(&mut state);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_set_counter_host(value: i64) -> i64 {
    let mut state = host_state().lock().unwrap();
    ensure_window(&mut state);
    state.counter = value;
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_present_host(r: i64, g: i64, b: i64) -> i64 {
    let mut state = host_state().lock().unwrap();
    ensure_window(&mut state);

    unsafe {
        ffi::BeginDrawing();
        ffi::ClearBackground(rgb(r, g, b));
    }

    let counter_text = CString::new(format!("Counter: {}", state.counter)).unwrap();
    unsafe {
        ffi::DrawText(counter_text.as_ptr(), 20, 20, 28, rgb(253, 249, 0));
    }

    for text in &state.queued_texts {
        let text_value = CString::new(text.text.as_str()).unwrap();
        unsafe {
            ffi::DrawText(text_value.as_ptr(), text.x, text.y, text.font_size, text.color);
        }
    }
    for circle in &state.queued_circles {
        unsafe {
            ffi::DrawCircle(circle.x, circle.y, circle.radius, circle.color);
        }
    }

    unsafe { ffi::EndDrawing() };
    state.queued_texts.clear();
    state.queued_circles.clear();
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
    ensure_window(&mut state);
    let text = unsafe { CStr::from_ptr(text) }
        .to_string_lossy()
        .into_owned();
    state.queued_texts.push(TextCommand {
        text,
        x: x as i32,
        y: y as i32,
        font_size: font_size.max(1).min(i64::from(i32::MAX)) as i32,
        color: rgb(r, g, b),
    });
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
    ensure_window(&mut state);
    state.queued_circles.push(CircleCommand {
        x: x as i32,
        y: y as i32,
        radius: radius.max(0) as f32,
        color: rgb(r, g, b),
    });
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_window_should_close_host() -> bool {
    let state = host_state().lock().unwrap();
    if !state.window_open {
        return false;
    }
    drop(state);
    unsafe { ffi::WindowShouldClose() }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rl_close_window_host() -> i64 {
    let mut state = host_state().lock().unwrap();
    close_window_if_open(&mut state);
    0
}
