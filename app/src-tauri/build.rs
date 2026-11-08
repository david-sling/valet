const COMMANDS: &[&str] = &["snapshot", "join", "decline", "start", "answer", "output_page", "set_grant", "extend", "end", "restart", "check_update", "export_json", "print_report", "take_join_link", "paste", "open_legal", "whats_new", "forget", "forget_all", "keep", "settings", "set_settings"];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri build");
}
