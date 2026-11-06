mod approve;
mod export;
mod needs;
mod policy;
mod relay;
mod sandbox;
mod session;
mod store;
mod tools;
mod types;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Emitter, Manager as _, RunEvent, State, Url};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;

use policy::Scope;
use relay::Relay;
use session::{GrantChoice, Manager, SessionView};

const DEFAULT_RELAY: &str = "https://valet.davidsling.in";
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const CODE_CHARS: &str = "ACDEFGHJKMNPQRTUVWXY34679";

#[derive(Default)]
struct JoinLink(Mutex<Option<String>>);

// The version already installed and waiting for a restart; the lock keeps two checks from installing at once.
#[derive(Default)]
struct Installed(tokio::sync::Mutex<Option<String>>);

fn join_code(url: &Url) -> Option<String> {
    if url.scheme() != "valet" || url.host_str() != Some("join") {
        return None;
    }
    let code: String = url.path().chars().filter(char::is_ascii_alphanumeric).collect::<String>().to_ascii_uppercase();
    (code.len() == 6 && code.chars().all(|c| CODE_CHARS.contains(c))).then_some(code)
}

// A link only fills in the code; joining still waits for the person to press Join.
fn open_links(app: &AppHandle, urls: &[Url]) {
    let Some(code) = urls.iter().find_map(join_code) else { return };
    *app.state::<JoinLink>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some(code);
    let _ = app.emit("join-link", ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn take_join_link(link: State<'_, JoinLink>) -> Option<String> {
    link.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[tauri::command]
fn snapshot(m: State<'_, Manager>) -> Vec<SessionView> {
    m.snapshot()
}

#[tauri::command]
async fn join(m: State<'_, Manager>, code: String) -> Result<SessionView, String> {
    m.inner().clone().join(&code).await
}

#[tauri::command]
async fn decline(m: State<'_, Manager>, id: String) -> Result<(), String> {
    m.inner().clone().decline(&id).await
}

#[tauri::command]
async fn start(m: State<'_, Manager>, id: String, grants: Vec<GrantChoice>) -> Result<(), String> {
    m.inner().clone().start(&id, grants).await
}

#[tauri::command]
async fn answer(m: State<'_, Manager>, prompt: String, allow: bool, scope: Option<Scope>) -> Result<(), String> {
    m.inner().clone().answer(&prompt, allow, scope).await
}

#[tauri::command]
async fn set_grant(m: State<'_, Manager>, id: String, grant: String, on: bool) -> Result<(), String> {
    m.set_grant(&id, &grant, on)
}

#[tauri::command]
async fn extend(m: State<'_, Manager>, id: String) -> Result<(), String> {
    m.inner().clone().extend(&id).await
}

#[tauri::command]
async fn end(m: State<'_, Manager>, id: String) -> Result<(), String> {
    m.inner().clone().end(&id).await
}

#[tauri::command]
async fn restart(app: AppHandle, m: State<'_, Manager>) -> Result<(), String> {
    m.inner().clone().end_all().await;
    app.restart()
}

#[tauri::command]
async fn export_json(app: AppHandle, m: State<'_, Manager>, id: String, name: String) -> Result<bool, String> {
    let version = app.package_info().version.to_string();
    let record = m.snapshot().iter().find(|s| s.id == id).and_then(|s| export::record(s, &version, types::now_ms()));
    let record = record.ok_or("Only a finished session can be exported.")?;
    let Some(path) = app.dialog().file().set_file_name(export::file_name(&name)).add_filter("JSON", &["json"]).blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
    std::fs::write(path, text + "\n").map_err(|e| format!("Couldn't save the file: {e}"))?;
    Ok(true)
}

#[tauri::command]
fn print_report(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

async fn install_update(app: &AppHandle) -> Result<Option<String>, String> {
    let installed = app.state::<Installed>();
    let mut installed = installed.0.lock().await;
    if installed.is_some() {
        return Ok(installed.clone());
    }
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let _ = app.emit("update-found", update.version.clone());
    let (mut got, mut shown) = (0u64, None);
    let progress = |chunk: usize, total: Option<u64>| {
        got += chunk as u64;
        let percent = total.filter(|t| *t > 0).map(|t| (got * 100 / t).min(100));
        if percent != shown {
            shown = percent;
            let _ = app.emit("update-progress", percent);
        }
    };
    let result = update.download_and_install(progress, || {}).await;
    if let Err(e) = result {
        let _ = app.emit("update-failed", ());
        return Err(e.to_string());
    }
    *installed = Some(update.version.clone());
    let _ = app.emit("update-ready", update.version.clone());
    Ok(installed.clone())
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    install_update(&app).await
}

async fn keep_updated(app: AppHandle) {
    loop {
        if let Ok(Some(_)) = install_update(&app).await {
            return;
        }
        tokio::time::sleep(UPDATE_EVERY).await;
    }
}

fn add_update_item(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    if let Some(valet) = menu.items()?.first().and_then(|m| m.as_submenu()) {
        valet.insert(&MenuItem::with_id(app, "check-update", "Check for Updates…", true, None::<&str>)?, 1)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == "check-update" {
            let _ = app.emit("check-update", ());
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base = std::env::var("VALET_RELAY").unwrap_or_else(|_| DEFAULT_RELAY.into());
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(JoinLink::default())
        .manage(Installed::default())
        .setup(move |app| {
            let handle = app.handle().clone();
            let emit = Arc::new(move |views: Vec<SessionView>| {
                let _ = handle.emit("sessions", views);
            });
            let store = app.path().app_data_dir().ok().and_then(|dir| store::Store::open(&dir.join("valet.db")).ok()).map(Arc::new);
            app.manage(Manager::new(Relay::new(&base), emit, store));
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| open_links(&handle, &event.urls()));
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                open_links(app.handle(), &urls);
            }
            add_update_item(app.handle())?;
            if !cfg!(debug_assertions) {
                tauri::async_runtime::spawn(keep_updated(app.handle().clone()));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![snapshot, join, decline, start, answer, set_grant, extend, end, restart, check_update, export_json, print_report, take_join_link])
        .build(tauri::generate_context!())
        .expect("error while building Valet")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                let m = app.state::<Manager>().inner().clone();
                tauri::async_runtime::block_on(async move {
                    let _ = tokio::time::timeout(Duration::from_secs(3), m.end_all()).await;
                });
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(s: &str) -> Option<String> {
        join_code(&Url::parse(s).unwrap())
    }

    #[test]
    fn reads_only_a_well_formed_join_link() {
        assert_eq!(code("valet://join/ACD347").as_deref(), Some("ACD347"));
        assert_eq!(code("valet://join/acd-347").as_deref(), Some("ACD347"));
        assert_eq!(code("valet://join/ACD347/"), Some("ACD347".into()));
        assert_eq!(code("valet://start/ACD347"), None);
        assert_eq!(code("https://join/ACD347"), None);
        assert_eq!(code("valet://join/ACD34"), None);
        assert_eq!(code("valet://join/ACD3470"), None);
        assert_eq!(code("valet://join/ABC123"), None);
    }
}
