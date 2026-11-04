mod approve;
mod needs;
mod policy;
mod relay;
mod sandbox;
mod session;
mod tools;
mod types;

use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager as _, RunEvent, State};

use policy::Scope;
use relay::Relay;
use session::{GrantChoice, Manager, SessionView};

const DEFAULT_RELAY: &str = "https://valet.davidsling.in";

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
fn set_grant(m: State<'_, Manager>, id: String, grant: String, on: bool) -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base = std::env::var("VALET_RELAY").unwrap_or_else(|_| DEFAULT_RELAY.into());
    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            let emit = Arc::new(move |views: Vec<SessionView>| {
                let _ = handle.emit("sessions", views);
            });
            app.manage(Manager::new(Relay::new(&base), emit));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![snapshot, join, decline, start, answer, set_grant, extend, end])
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
