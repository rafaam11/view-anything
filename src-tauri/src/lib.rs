mod args;
mod cloud;
mod update;
mod text_codec;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use percent_encoding::{percent_decode, utf8_percent_encode, NON_ALPHANUMERIC};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use args::file_arg;

static WINDOW_SEQ: AtomicUsize = AtomicUsize::new(0);
static FILE_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    write_bytes(&path, &data)
}

fn read_raw(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{path}: {e}"))
}

fn write_bytes(path: &str, data: &[u8]) -> Result<(), String> {
    let _guard = FILE_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let target = write_target(Path::new(path));
    write_atomic(&target, data).map_err(|e| format!("{path}: {e}"))
}

/// Compare and replace under the process-wide write lock, so two app windows cannot both
/// commit edits based on the same original. Returns false when the disk no longer matches.
fn write_if_unchanged(path: &Path, expected: &[u8], data: &[u8]) -> Result<bool, String> {
    let _guard = FILE_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let target = write_target(path);
    match std::fs::read(&target) {
        Ok(current) if current == expected => {},
        Ok(_) => return Ok(false),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    }
    write_atomic(&target, data).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn write_file_checked(request: tauri::ipc::Request<'_>) -> Result<bool, String> {
    let path = decode_path_header(request.headers().get("x-va-path").map(|v| v.as_bytes()))?;
    let len = request.headers().get("x-va-expected-length").ok_or("missing expected length")?
        .to_str().map_err(|e| e.to_string())?.parse::<usize>().map_err(|e| e.to_string())?;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) if len <= data.len() => data.to_vec(),
        _ => return Err("invalid checked write body".into()),
    };
    tauri::async_runtime::spawn_blocking(move || write_if_unchanged(Path::new(&path), &data[..len], &data[len..]))
        .await.map_err(|e| e.to_string())?
}

/// Save a new file without ever replacing an existing directory entry.
fn write_new(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    static COPY_SEQ: AtomicUsize = AtomicUsize::new(0);
    let name = path.file_name().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a file path"))?;
    let (tmp, mut file) = loop {
        let mut temp_name = std::ffi::OsString::from(".");
        temp_name.push(name);
        temp_name.push(format!(".va-copy-{}-{}", std::process::id(), COPY_SEQ.fetch_add(1, Ordering::Relaxed)));
        let temp = path.with_file_name(temp_name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => break (temp, file),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    let result = (|| {
        file.write_all(data)?;
        file.sync_all()?;
        drop(file);
        // The link operation is atomic and fails if the target already exists. Filesystems
        // without hard-link support fail safely, leaving both source and target untouched.
        std::fs::hard_link(&tmp, path)
    })();
    let _ = std::fs::remove_file(tmp);
    result
}

#[tauri::command]
async fn write_file_new(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = decode_path_header(request.headers().get("x-va-path").map(|v| v.as_bytes()))?;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.to_vec(),
        _ => return Err("raw bytes required".into()),
    };
    tauri::async_runtime::spawn_blocking(move || write_new(Path::new(&path), &data).map_err(|e| format!("{path}: {e}")))
        .await.map_err(|e| e.to_string())?
}

/// Raw bytes for large files: a `Response` skips the JSON number-array encoding of `read_file`.
/// Async so a big read runs off the main thread.
#[tauri::command]
async fn read_file_raw(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || read_raw(&path).map(tauri::ipc::Response::new))
        .await.map_err(|e| e.to_string())?
}

/// The `x-va-path` header value: a percent-encoded UTF-8 path (headers cannot carry it raw).
fn decode_path_header(value: Option<&[u8]>) -> Result<String, String> {
    let raw = value.ok_or("missing x-va-path header")?;
    let path = percent_decode(raw)
        .decode_utf8()
        .map_err(|e| format!("x-va-path is not UTF-8: {e}"))?
        .into_owned();
    if path.is_empty() {
        return Err("empty x-va-path header".into());
    }
    Ok(path)
}

/// Raw-body counterpart of `write_file`: the body is the file content, the path is in `x-va-path`.
#[tauri::command]
async fn write_file_raw(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = decode_path_header(request.headers().get("x-va-path").map(|v| v.as_bytes()))?;
    match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => write_bytes(&path, data),
        tauri::ipc::InvokeBody::Json(_) => Err("write_file_raw expects a raw byte body".into()),
    }
}

#[tauri::command]
async fn write_image_copy(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = decode_path_header(request.headers().get("x-va-path").map(|v| v.as_bytes()))?;
    let source = decode_path_header(request.headers().get("x-va-source").map(|v| v.as_bytes()))?;
    let target = image_copy_target(Path::new(&path), Path::new(&source))?;
    match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => write_atomic(&target, data).map_err(|e| e.to_string()),
        tauri::ipc::InvokeBody::Json(_) => Err("raw bytes required".into()),
    }
}

fn image_copy_target(path: &Path, source: &Path) -> Result<PathBuf, String> {
    let source = std::fs::canonicalize(source).map_err(|e| e.to_string())?;
    let target = write_target(path);
    if target == source || std::fs::canonicalize(&target).ok().as_ref() == Some(&source) {
        return Err("원본 이미지는 덮어쓸 수 없습니다".into());
    }
    Ok(target)
}

/// Whether Shift is held right now (drop events do not carry modifier keys). `None` where the
/// OS offers no global key state query.
#[tauri::command]
fn modifier_shift() -> Option<bool> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
        // SAFETY: GetAsyncKeyState has no preconditions; the high bit means "key is down".
        let state = unsafe { GetAsyncKeyState(VK_SHIFT as i32) };
        Some((state as u16 & 0x8000) != 0)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Lets the viewer check a link target before leaving the current document.
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Check size before allocating or sending file contents to a viewer.
#[tauri::command]
async fn file_size(path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let metadata = std::fs::metadata(&path).map_err(|e| format!("{path}: {e}"))?;
        if !metadata.is_file() {
            return Err(format!("{path}: 일반 파일이 아닙니다"));
        }
        Ok(metadata.len())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn sibling_images(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&path).parent().ok_or("상위 폴더가 없습니다")?;
        let mut files = Vec::new();
        for item in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
            let p = item.map_err(|e| e.to_string())?.path();
            if !p.is_file() { continue; }
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
            if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "svg") {
                files.push(p.to_string_lossy().into_owned());
            }
        }
        files.sort_by_key(|s| s.to_lowercase());
        Ok(files)
    }).await.map_err(|e| e.to_string())?
}

/// The file a save must replace. For a symlink that is the link's final target: renaming the
/// temporary file over the link itself would turn it into a regular file and leave the real
/// file stale.
fn write_target(path: &Path) -> PathBuf {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

/// Write to a temporary sibling, then rename it over `path` (a replacing rename on Windows and
/// Unix), so a crash or a full disk never leaves a half-written file behind.
fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    static TEMP_SEQ: AtomicUsize = AtomicUsize::new(0);
    let name = path
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a file path"))?;
    let (tmp, f) = loop {
        let mut tmp_name = std::ffi::OsString::from(".");
        tmp_name.push(name);
        tmp_name.push(format!(".va-tmp-{}-{}", std::process::id(), TEMP_SEQ.fetch_add(1, Ordering::Relaxed)));
        let tmp = path.with_file_name(tmp_name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(f) => break (tmp, f),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    let result = (|| {
        let mut f = f;
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
    create_window_mode(app, file, false)
}

fn create_window_mode(app: &AppHandle, file: Option<PathBuf>, text: bool) -> Result<(), String> {
    let label = format!("w{}", WINDOW_SEQ.fetch_add(1, Ordering::SeqCst));
    let title = file
        .as_deref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "view-anything".to_string());
    let mut url = window_url(file.as_deref());
    if text { url.push_str(if url.contains('?') { "&text=1" } else { "?text=1" }); }
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .decorations(false)
        .inner_size(1000.0, 800.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The most recently created viewer window label (`w<N>` with the largest N).
fn latest_label<'a>(labels: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    labels
        .into_iter()
        .filter_map(|l| l.strip_prefix('w')?.parse::<usize>().ok().map(|n| (n, l)))
        .max_by_key(|(n, _)| *n)
        .map(|(_, l)| l)
}

/// A second launch without a file (e.g. from the Start menu) brings the app forward.
fn focus_latest_window(app: &AppHandle) {
    let windows = app.webview_windows();
    match latest_label(windows.keys().map(String::as_str)).and_then(|l| windows.get(l)) {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        None => {
            if let Err(e) = create_window(app, None) {
                eprintln!("failed to open window: {e}");
            }
        }
    }
}

#[tauri::command]
async fn open_window(app: AppHandle, path: Option<String>, text: Option<bool>) -> Result<(), String> {
    create_window_mode(&app, path.map(PathBuf::from), text.unwrap_or(false))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(update::Coordinator::default())
        .manage(cloud::Clouds::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle().clone();
                let owner = window.label().to_owned();
                tauri::async_runtime::spawn_blocking(move || app.state::<cloud::Clouds>().close_window(&owner));
            }
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(p) = file_arg(&argv) {
                let p = if p.is_absolute() { p } else { Path::new(&cwd).join(p) };
                if let Err(e) = create_window(app, Some(p)) {
                    eprintln!("failed to open window: {e}");
                }
            } else {
                focus_latest_window(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            read_file_raw,
            write_file_raw,
            write_file_checked,
            write_file_new,
            write_image_copy,
            modifier_shift,
            path_exists,
            file_size,
            sibling_images,
            open_window,
            text_codec::decode_cp949,
            text_codec::encode_cp949,
            update::update_context,
            update::update_status,
            update::update_request
            ,cloud::cloud_request, cloud::cloud_register, cloud::cloud_cancel, cloud::cloud_close, cloud::cloud_chunk, cloud::cloud_point
        ])
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
    fn new_file_save_preserves_existing_target_and_removes_temporary_file() {
        let dir = std::env::temp_dir().join(format!("va-new-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("copy.csv");
        write_new(&target, b"first").unwrap();
        assert!(write_new(&target, b"second").is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"first");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn checked_writes_from_two_windows_only_commit_once() {
        let dir = std::env::temp_dir().join(format!("va-checked-write-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.csv"); std::fs::write(&path, b"original").unwrap();
        let threads: Vec<_> = [b"first".as_slice(), b"second".as_slice()].into_iter().map(|data| {
            let path = path.clone();
            std::thread::spawn(move || write_if_unchanged(&path, b"original", data).unwrap())
        }).collect();
        let result: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(result.iter().filter(|&&v| v).count(), 1);
        let bytes = std::fs::read(&path).unwrap(); assert!(bytes == b"first" || bytes == b"second");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn image_copy_refuses_the_original() {
        let dir = std::env::temp_dir().join(format!("va-image-copy-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.png");
        std::fs::write(&source, b"original").unwrap();
        assert!(image_copy_target(&source, &source).is_err());
        assert!(image_copy_target(&dir.join("copy.png"), &source).is_ok());
        assert_eq!(std::fs::read(&source).unwrap(), b"original");
        std::fs::remove_dir_all(dir).unwrap();
    }

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
    fn concurrent_atomic_writes_never_mix_contents() {
        let dir = std::env::temp_dir().join(format!("va-concurrent-write-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("data.md");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let threads: Vec<_> = (0..8u8).map(|value| {
            let path = target.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let data = vec![value; 128 * 1024];
                barrier.wait();
                write_atomic(&path, &data).unwrap();
            })
        }).collect();
        for thread in threads { thread.join().unwrap(); }
        let data = std::fs::read(&target).unwrap();
        assert_eq!(data.len(), 128 * 1024);
        assert!(data.iter().all(|b| *b == data[0]));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_file(target).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn latest_label_picks_the_highest_window_number() {
        assert_eq!(latest_label(["w0", "w10", "w9"]), Some("w10"));
        assert_eq!(latest_label(["main", "w2"]), Some("w2"));
        assert_eq!(latest_label(Vec::<&str>::new()), None);
        assert_eq!(latest_label(["main"]), None);
    }

    #[test]
    fn write_target_keeps_regular_and_missing_paths() {
        let missing = std::env::temp_dir().join("va-no-such-file-xyz.md");
        assert_eq!(write_target(&missing), missing);
        let dir = std::env::temp_dir().join(format!("va-target-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.md");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(write_target(&file), file);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn saving_through_a_symlink_updates_the_target_and_keeps_the_link() {
        let dir = std::env::temp_dir().join(format!("va-symlink-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let real = dir.join("real.md");
        let link = dir.join("link.md");
        std::fs::write(&real, b"old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write_atomic(&write_target(&link), b"new").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(&real).unwrap(), b"new");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Windows needs Developer Mode or admin rights to create symlinks; skip when refused.
    #[cfg(windows)]
    #[test]
    fn saving_through_a_symlink_updates_the_target_and_keeps_the_link_windows() {
        let dir = std::env::temp_dir().join(format!("va-symlink-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let real = dir.join("real.md");
        let link = dir.join("link.md");
        std::fs::write(&real, b"old").unwrap();
        if let Err(e) = std::os::windows::fs::symlink_file(&real, &link) {
            eprintln!("skipping: cannot create symlink ({e})");
            std::fs::remove_dir_all(&dir).unwrap();
            return;
        }
        write_atomic(&write_target(&link), b"new").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(&real).unwrap(), b"new");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn raw_write_then_read_round_trips_every_byte() {
        let dir = std::env::temp_dir().join(format!("va-raw-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("모델 a.stl");
        let data: Vec<u8> = (0..=255u8).cycle().take(70_000).collect();
        write_bytes(target.to_str().unwrap(), &data).unwrap();
        assert_eq!(read_raw(target.to_str().unwrap()).unwrap(), data);
        write_bytes(target.to_str().unwrap(), b"").unwrap();
        assert_eq!(read_raw(target.to_str().unwrap()).unwrap(), b"");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn read_raw_reports_the_path_on_error() {
        let err = read_raw("va-no-such-file-xyz.stl").unwrap_err();
        assert!(err.contains("va-no-such-file-xyz.stl"), "{err}");
    }

    #[test]
    fn path_header_is_percent_decoded() {
        assert_eq!(decode_path_header(Some(b"D%3A%5Ca%20b.stl")).unwrap(), "D:\\a b.stl");
        assert_eq!(
            decode_path_header(Some(b"%2Fhome%2F%ED%8F%B4%EB%8D%94%2Fx.html")).unwrap(),
            "/home/폴더/x.html"
        );
        assert_eq!(decode_path_header(Some(b"plain.glb")).unwrap(), "plain.glb");
    }

    #[test]
    fn path_header_rejects_missing_empty_and_invalid_utf8() {
        assert!(decode_path_header(None).is_err());
        assert!(decode_path_header(Some(b"")).is_err());
        assert!(decode_path_header(Some(b"%FF%FE")).is_err());
    }

    #[test]
    fn modifier_shift_does_not_panic() {
        let v = modifier_shift();
        if cfg!(windows) {
            assert!(v.is_some());
        } else {
            assert_eq!(v, None);
        }
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
