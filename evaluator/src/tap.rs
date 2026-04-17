use crate::value::Value;
use std::io::{self, Write};

pub fn emit_tap(reference: u64, label: &str, value: &Value) {
    let event = serde_json::json!({
        "type": "tap",
        "reference": reference,
        "label": label,
        "value": value.to_itf(),
    });

    let mut stderr = io::stderr().lock();
    serde_json::to_writer(&mut stderr, &event).expect("failed to write tap event to stderr");
    writeln!(stderr).expect("failed to terminate tap event");
}
