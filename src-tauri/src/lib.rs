mod args;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

use args::file_arg;

static WINDOW_SEQ: AtomicUsize = AtomicUsize::new(0);

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    write_atomic(Path::new(&path), &data).map_err(|e| format!("{path}: {e}"))
}

/// Write to a temporary sibling, then rename it over `path` (a replacing rename on Windows and
/// Unix), so a crash or a full disk never leaves a half-written file behind.
fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let name = path
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a file path"))?;
    let mut tmp_name = std::ffi::OsString::from(".");
    tmp_name.push(name);
    tmp_name.push(format!(".va-tmp-{}", std::process::id()));
    let tmp = path.with_file_name(tmp_name);
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// `index.html` plus `?file=<percent-encoded path>` when a file is given.
fn window_url(file: Option<&Path>) -> String {
    match file {
        Some(p) => {
            let s = p.to_string_lossy();
            format!("index.html?file={}", utf8_percent_encode(&s, NON_ALPHANUMERIC))
        }
        None => "index.html".to_string(),
    }
}

fn create_window(app: &AppHandle, file: Option<PathBuf>) -> Result<(), String> {
    let label = format!("w{}", WINDOW_SEQ.fetch_add(1, Ordering::SeqCst));
    let title = file
        .as_deref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "view-anything".to_string());
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(window_url(file.as_deref()).into()))
        .title(title)
        .inner_size(1000.0, 800.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_window(app: AppHandle, path: Option<String>) -> Result<(), String> {
    create_window(&app, path.map(PathBuf::from))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(p) = file_arg(&argv) {
                let p = if p.is_absolute() { p } else { Path::new(&cwd).join(p) };
                if let Err(e) = create_window(app, Some(p)) {
                    eprintln!("failed to open window: {e}");
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file, open_window])
        .setup(|app| {
            let argv: Vec<String> = std::env::args().collect();
            create_window(app.handle(), file_arg(&argv))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_replaces_existing_file_without_leftovers() {
        let dir = std::env::temp_dir().join(format!("va-write-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("a b.md");
        std::fs::write(&target, b"old content that is longer").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        write_atomic(&target, b"newer").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"newer");
        let entries: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("a b.md")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_atomic_fails_cleanly_for_missing_directory() {
        let target = std::env::temp_dir().join("va-no-such-dir-xyz").join("a.md");
        assert!(write_atomic(&target, b"x").is_err());
    }

    #[test]
    fn url_encodes_path() {
        assert_eq!(window_url(None), "index.html");
        assert_eq!(
            window_url(Some(Path::new("D:\\a b.md"))),
            "index.html?file=D%3A%5Ca%20b%2Emd"
        );
    }
}
