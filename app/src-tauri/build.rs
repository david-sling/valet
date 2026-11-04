const COMMANDS: &[&str] = &["snapshot", "join", "decline", "start", "answer", "set_grant", "extend", "end"];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri build");
}
