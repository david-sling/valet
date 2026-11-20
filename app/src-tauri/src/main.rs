#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The elevated copy UAC starts to run one approved command: it must never start the app or hand off to the copy running
    #[cfg(windows)]
    if let Some(code) = valet_lib::run_elevated_helper() {
        std::process::exit(code);
    }
    valet_lib::run()
}
