#[unsafe(no_mangle)]
pub unsafe extern "C" fn add1_host(value: i64) -> i64 {
    value + 1
}
