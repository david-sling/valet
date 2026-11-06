mod approve;
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

use tauri::{AppHandle, Emitter, Manager as _, RunEvent, State, Url};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_updater::UpdaterExt;

use policy::Scope;
use relay::Relay;
use session::{GrantChoice, Manager, SessionView};

const DEFAULT_RELAY: &str = "https://valet.davidsling.in";
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const CODE_CHARS: &str = "ACDEFGHJKMNPQRTUVWXY34679";

#[derive(Default)]
struct JoinLink(Mutex<Option<String>>);

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

async fn keep_updated(app: AppHandle) {
    loop {
        let found = match app.updater() {
            Ok(u) => u.check().await.ok().flatten(),
            Err(_) => None,
        };
        if let Some(update) = found {
            if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                let _ = app.emit("update-ready", update.version.clone());
                return;
            }
        }
        tokio::time::sleep(UPDATE_EVERY).await;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base = std::env::var("VALET_RELAY").unwrap_or_else(|_| DEFAULT_RELAY.into());
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .manage(JoinLink::default())
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
            if !cfg!(debug_assertions) {
                tauri::async_runtime::spawn(keep_updated(app.handle().clone()));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![snapshot, join, decline, start, answer, set_grant, extend, end, restart, take_join_link])
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
