use crate::value::Value;
use std::io::{self, Write};

fn emit_event(event: &serde_json::Value) {
    let mut stderr = io::stderr().lock();
    serde_json::to_writer(&mut stderr, event).expect("failed to write tap event to stderr");
    writeln!(stderr).expect("failed to terminate tap event");
}

pub fn emit_trace_start() {
    emit_event(&serde_json::json!({
        "type": "trace-start",
    }));
}

pub fn emit_trace_end() {
    emit_event(&serde_json::json!({
        "type": "trace-end",
    }));
}

pub struct TraceScope {
    enabled: bool,
}

impl Drop for TraceScope {
    fn drop(&mut self) {
        if self.enabled {
            emit_trace_end();
        }
    }
}

pub fn trace_scope(enabled: bool) -> TraceScope {
    if enabled {
        emit_trace_start();
    }
    TraceScope { enabled }
}

pub fn emit_tap(reference: u64, label: &str, value: &Value) {
    emit_event(&serde_json::json!({
        "type": "tap",
        "reference": reference,
        "label": label,
        "value": value.to_itf(),
    }));
}
