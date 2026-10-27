//! Single updater owner per process. Viewer windows may close in any order.
use std::sync::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Default)]
pub struct Coordinator(pub Mutex<Session>);

#[derive(Default)]
pub struct Session {
    owner: Option<String>,
    started: bool,
    status: Option<Value>,
}

#[derive(Serialize)]
pub struct Context {
    owner: String,
    startup: bool,
    status: Value,
    windows: Vec<String>,
}

fn choose_owner(session: &mut Session, windows: &[String]) -> String {
    if !session.owner.as_ref().is_some_and(|owner| windows.contains(owner)) {
        session.owner = windows.iter().min_by_key(|label| label.trim_start_matches('w').parse::<usize>().unwrap_or(usize::MAX)).cloned();
    }
    session.owner.clone().unwrap_or_default()
}

#[tauri::command]
pub fn update_context(app: AppHandle, window: WebviewWindow, state: State<'_, Coordinator>) -> Result<Context, String> {
    let windows: Vec<_> = app.webview_windows().keys().cloned().collect();
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    let owner = choose_owner(&mut session, &windows);
    let startup = owner == window.label() && !session.started;
    if startup { session.started = true; }
    Ok(Context { owner, startup, windows, status: session.status.clone().unwrap_or_else(|| json!({"state":"idle"})) })
}

#[tauri::command]
pub fn update_status(app: AppHandle, window: WebviewWindow, state: State<'_, Coordinator>, status: Value) -> Result<(), String> {
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    if session.owner.as_deref() != Some(window.label()) { return Err("not updater owner".into()); }
    session.status = Some(status.clone());
    drop(session);
    app.emit("va-update-status", status).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_request(app: AppHandle, state: State<'_, Coordinator>, action: String) -> Result<(), String> {
    if action != "check" && action != "install" { return Err("invalid updater action".into()); }
    let windows: Vec<_> = app.webview_windows().keys().cloned().collect();
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    let owner = choose_owner(&mut session, &windows);
    drop(session);
    app.emit_to(owner, "va-update-request", action).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ownership_survives_new_windows_and_moves_when_closed() {
        let mut s = Session::default();
        assert_eq!(choose_owner(&mut s, &["w10".into(), "w2".into(), "w0".into()]), "w0");
        assert_eq!(choose_owner(&mut s, &["w2".into(), "w10".into()]), "w2");
        assert_eq!(choose_owner(&mut s, &["w1".into(), "w2".into()]), "w2");
    }
}
