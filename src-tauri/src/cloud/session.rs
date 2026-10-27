use super::{
    codec::{self, Cloud, MAX_POINTS, Parsed, Result},
    process::{self, Operation},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tauri::{Emitter, Manager};

const APP_BYTES: usize = 8 * 1024 * 1024 * 1024;
const CHUNK: usize = 25_000;
#[derive(Default)]
pub struct Clouds {
    sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
    jobs: Mutex<HashMap<String, (String, Arc<AtomicBool>)>>,
    busy: AtomicBool,
    seq: AtomicU64,
}
struct Session {
    owner: String,
    path: PathBuf,
    cloud: Arc<Cloud>,
    active: Arc<Vec<u32>>,
    saved: Arc<Vec<u32>>,
    undo: Vec<Arc<Vec<u32>>>,
    redo: Vec<Arc<Vec<u32>>>,
    preview: Option<Arc<Vec<u32>>>,
    selection: Arc<Vec<u32>>,
    revision: u64,
    origin: [f64; 3],
    closed: bool,
}
impl Session {
    fn ids(&self) -> &Arc<Vec<u32>> {
        self.preview.as_ref().unwrap_or(&self.active)
    }
    fn dirty(&self) -> bool {
        !Arc::ptr_eq(&self.active, &self.saved)
    }
    fn estimate(&self) -> usize {
        self.cloud.memory() + self.cloud.len() * 320
    }
    fn apply(&mut self, ids: Arc<Vec<u32>>) {
        self.undo.push(self.active.clone());
        if self.undo.len() > 20 {
            self.undo.remove(0);
        }
        self.active = ids;
        self.redo.clear();
        self.preview = None;
        self.selection = Arc::new(vec![]);
        self.revision += 1;
    }
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    id: String,
    revision: u64,
    count: usize,
    original_count: usize,
    invalid: usize,
    selected: usize,
    origin: [f64; 3],
    bounds: [f64; 6],
    dirty: bool,
    preview: bool,
    can_undo: bool,
    can_redo: bool,
    editable: bool,
    warning: Option<String>,
    has_rgb: bool,
    has_intensity: bool,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    Open { path: String },
    Filter { operation: Operation },
    Crop { keep: bool },
    Apply,
    DiscardPreview,
    Undo,
    Redo,
    ClearSelection,
    Save { path: String, overwrite: bool },
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    job_id: String,
    phase: String,
    loaded: usize,
    total: usize,
}

fn bounds(cloud: &Cloud, ids: &[u32]) -> ([f64; 6], usize) {
    let mut b = [f64::INFINITY; 6];
    b[3..].fill(f64::NEG_INFINITY);
    let mut invalid = 0;
    for &id in ids {
        let p = cloud.positions[id as usize];
        if !process::finite(&p) {
            invalid += 1;
            continue;
        }
        for a in 0..3 {
            b[a] = b[a].min(p[a]);
            b[a + 3] = b[a + 3].max(p[a]);
        }
    }
    if !b[0].is_finite() {
        b = [0.; 6];
    }
    (b, invalid)
}
fn meta(id: &str, s: &Session) -> Meta {
    let (bounds, invalid) = bounds(&s.cloud, s.ids());
    Meta {
        id: id.into(),
        revision: s.revision,
        count: s.ids().len(),
        original_count: s.cloud.len(),
        invalid,
        selected: s.selection.len(),
        origin: s.origin,
        bounds,
        dirty: s.dirty(),
        preview: s.preview.is_some(),
        can_undo: !s.undo.is_empty(),
        can_redo: !s.redo.is_empty(),
        editable: s.cloud.editable,
        warning: s.cloud.warning.clone(),
        has_rgb: s
            .cloud
            .fields
            .iter()
            .any(|f| matches!(f.name.as_str(), "rgb" | "rgba" | "red" | "r")),
        has_intensity: s.cloud.fields.iter().any(|f| f.name == "intensity"),
    }
}
impl Clouds {
    fn session(&self, owner: &str, id: &str) -> Result<Arc<Mutex<Session>>> {
        let s = self
            .sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or("클라우드 세션이 없습니다")?;
        {
            let guard = s.lock().unwrap();
            if guard.owner != owner || guard.closed {
                return Err("다른 창의 세션에는 접근할 수 없습니다".into());
            }
        }
        Ok(s)
    }
    pub fn close_window(&self, owner: &str) {
        for (_, (w, c)) in self.jobs.lock().unwrap().iter() {
            if w == owner {
                c.store(true, Ordering::Relaxed);
            }
        }
        self.sessions.lock().unwrap().retain(|_, s| {
            let mut s = s.lock().unwrap();
            if s.owner == owner {
                s.closed = true;
                false
            } else {
                true
            }
        });
    }
}
struct JobGuard {
    app: tauri::AppHandle,
    id: String,
}
impl Drop for JobGuard {
    fn drop(&mut self) {
        let state = self.app.state::<Clouds>();
        state.jobs.lock().unwrap().remove(&self.id);
        state.busy.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn cloud_request(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    job_id: String,
    session: Option<String>,
    revision: Option<u64>,
    action: Action,
) -> Result<Option<Meta>> {
    if job_id.len() > 128 {
        return Err("작업 ID 오류".into());
    }
    let state = app.state::<Clouds>();
    if state
        .busy
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        return Err("다른 포인트클라우드 작업이 진행 중입니다".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .jobs
        .lock()
        .unwrap()
        .insert(job_id.clone(), (window.label().into(), cancel.clone()));
    let guard = JobGuard {
        app: app.clone(),
        id: job_id.clone(),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let state = app.state::<Clouds>();
        let owner = window.label();
        let mut last = None;
        let mut check = |loaded: usize, total: usize| -> Result<()> {
            if cancel.load(Ordering::Relaxed) || app.get_webview_window(owner).is_none() {
                return Err("작업을 취소했습니다".into());
            }
            let percent = if total > 0 {
                loaded.saturating_mul(100) / total
            } else {
                0
            };
            if last != Some(percent) {
                last = Some(percent);
                let _ = window.emit(
                    "va-cloud-progress",
                    Progress {
                        job_id: job_id.clone(),
                        phase: "처리 중".into(),
                        loaded,
                        total,
                    },
                );
            }
            Ok(())
        };
        check(0, 0)?;
        if let Action::Open { path } = &action {
            let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            let size = f.metadata().map_err(|e| e.to_string())?.len();
            if size > codec::MAX_BYTES as u64 {
                return Err("입력 파일 2GiB 한도를 초과합니다".into());
            }
            // Compressed decoding may hold input + planar + records. Reserve worst case before allocation.
            let used = state
                .sessions
                .lock()
                .unwrap()
                .values()
                .map(|s| s.lock().unwrap().estimate())
                .sum::<usize>();
            if used > APP_BYTES - 6 * 1024 * 1024 * 1024 {
                return Err("안전한 디코딩 공간이 부족합니다. 다른 클라우드를 닫아 주세요".into());
            }
            let cloud = match codec::read(std::io::BufReader::new(f), &ext, &mut check)? {
                Parsed::Cloud(c) => c,
                Parsed::Mesh => return Ok(None),
            };
            let loaded = state
                .sessions
                .lock()
                .unwrap()
                .values()
                .filter_map(|s| {
                    let s = s.lock().unwrap();
                    (s.owner == owner).then_some(s.cloud.len())
                })
                .sum::<usize>();
            if loaded + cloud.len() > MAX_POINTS {
                return Err("장면 합계 1천만 점 한도를 초과합니다".into());
            }
            let ids = Arc::new((0..cloud.len() as u32).collect::<Vec<_>>());
            let (b, _) = bounds(&cloud, &ids);
            let origin = std::array::from_fn(|a| b[a] / 2. + b[a + 3] / 2.);
            let s = Session {
                owner: owner.into(),
                path,
                cloud: Arc::new(cloud),
                active: ids.clone(),
                saved: ids,
                undo: vec![],
                redo: vec![],
                preview: None,
                selection: Arc::new(vec![]),
                revision: 0,
                origin,
                closed: false,
            };
            if used + s.estimate() > APP_BYTES {
                return Err("예상 작업 메모리 8GiB 한도를 초과합니다".into());
            }
            check(1, 1)?;
            let id = format!("c{}", state.seq.fetch_add(1, Ordering::Relaxed));
            let m = meta(&id, &s);
            state
                .sessions
                .lock()
                .unwrap()
                .insert(id, Arc::new(Mutex::new(s)));
            return Ok(Some(m));
        }
        let id = session.ok_or("세션 ID 누락")?;
        let handle = state.session(owner, &id)?;
        let (cloud, active, selection, path) = {
            let s = handle.lock().unwrap();
            if Some(s.revision) != revision {
                return Err("작업본이 변경되었습니다. 다시 시도하세요".into());
            }
            if !s.cloud.editable
                && !matches!(
                    action,
                    Action::Filter {
                        operation: Operation::Select { .. }
                    } | Action::ClearSelection
                )
            {
                return Err("추가 요소가 있는 파일은 편집할 수 없습니다".into());
            }
            (
                s.cloud.clone(),
                s.active.clone(),
                s.selection.clone(),
                s.path.clone(),
            )
        };
        let mut candidate = None;
        match &action {
            Action::Filter { operation } => {
                candidate = Some(Arc::new(process::run(
                    &cloud, &active, operation, &mut check,
                )?))
            }
            Action::Crop { keep } => {
                let mut selected = selection.iter().peekable();
                let mut ids = vec![];
                for (i, &id) in active.iter().enumerate() {
                    if i % 16384 == 0 {
                        check(i, active.len())?;
                    }
                    while selected.peek().is_some_and(|&&v| v < id) {
                        selected.next();
                    }
                    let hit = selected.peek().is_some_and(|&&v| v == id);
                    if hit == *keep && process::finite(&cloud.positions[id as usize]) {
                        ids.push(id);
                    }
                }
                candidate = Some(Arc::new(ids));
            }
            Action::Save {
                path: target,
                overwrite,
            } => {
                save(
                    &cloud,
                    &active,
                    &path,
                    Path::new(target),
                    *overwrite,
                    &job_id,
                    &mut check,
                )?;
            }
            _ => {}
        }
        check(1, 1)?;
        let mut s = handle.lock().unwrap();
        if s.closed || Some(s.revision) != revision {
            return Err("세션이 닫혔거나 변경되었습니다".into());
        }
        match action {
            Action::Filter {
                operation: Operation::Select { .. },
            } => {
                s.selection = candidate.unwrap();
                s.preview = None;
                s.revision += 1;
            }
            Action::Filter { .. } | Action::Crop { .. } => {
                s.preview = candidate;
                s.revision += 1;
            }
            Action::Apply => {
                let p = s.preview.take().ok_or("적용할 결과가 없습니다")?;
                s.apply(p);
            }
            Action::DiscardPreview => {
                s.preview = None;
                s.revision += 1;
            }
            Action::Undo => {
                if let Some(v) = s.undo.pop() {
                    let a = s.active.clone();
                    s.redo.push(a);
                    s.active = v;
                    s.preview = None;
                    s.selection = Arc::new(vec![]);
                    s.revision += 1;
                }
            }
            Action::Redo => {
                if let Some(v) = s.redo.pop() {
                    let a = s.active.clone();
                    s.undo.push(a);
                    s.active = v;
                    s.preview = None;
                    s.selection = Arc::new(vec![]);
                    s.revision += 1;
                }
            }
            Action::ClearSelection => {
                s.selection = Arc::new(vec![]);
                s.revision += 1;
            }
            Action::Save { .. } => s.saved = s.active.clone(),
            Action::Open { .. } => unreachable!(),
        }
        Ok(Some(meta(&id, &s)))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save(
    cloud: &Cloud,
    ids: &[u32],
    source: &Path,
    target: &Path,
    overwrite: bool,
    job: &str,
    check: &mut impl FnMut(usize, usize) -> Result<()>,
) -> Result<()> {
    let target = crate::write_target(target);
    let parent = target
        .parent()
        .ok_or("저장 폴더 누락")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = parent.join(target.file_name().ok_or("파일명 누락")?);
    let canonical = target.canonicalize().unwrap_or_else(|_| target.clone());
    #[cfg(windows)]
    let same =
        canonical.to_string_lossy().to_lowercase() == source.to_string_lossy().to_lowercase();
    #[cfg(not(windows))]
    let same = canonical == source;
    if same {
        return Err("원본 파일에는 덮어쓸 수 없습니다".into());
    }
    let ext = match cloud.format {
        codec::Format::Pcd { .. } => "pcd",
        codec::Format::Ply => "ply",
    };
    if !target
        .extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| v.eq_ignore_ascii_case(ext))
    {
        return Err("원본과 같은 확장자로 저장해야 합니다".into());
    }
    if target.exists() && !overwrite {
        return Err("기존 파일 덮어쓰기 확인이 필요합니다".into());
    }
    // Unique create_new sibling, bounded filename independent of caller's job ID.
    let unique = job
        .bytes()
        .fold(0u64, |v, b| v.wrapping_mul(31).wrapping_add(b as u64));
    let temp = parent.join(format!(".va-cloud-{}-{unique}.tmp", std::process::id()));
    let f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        use std::io::Write;
        let mut writer = std::io::BufWriter::new(f);
        codec::write(cloud, ids, &mut writer, check)?;
        writer.flush().map_err(|e| e.to_string())?;
        writer.get_ref().sync_all().map_err(|e| e.to_string())?;
        drop(writer);
        check(1, 1)?;
        if !overwrite && target.exists() {
            return Err("저장 대상이 새로 생겼습니다. 다시 확인하세요".into());
        }
        std::fs::rename(&temp, &target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

#[tauri::command]
pub fn cloud_cancel(window: tauri::WebviewWindow, state: tauri::State<Clouds>, job_id: String) {
    if let Some((owner, c)) = state.jobs.lock().unwrap().get(&job_id) {
        if owner == window.label() {
            c.store(true, Ordering::Relaxed);
        }
    }
}
#[tauri::command]
pub fn cloud_close(
    window: tauri::WebviewWindow,
    state: tauri::State<Clouds>,
    session: String,
) -> Result<()> {
    let s = state.session(window.label(), &session)?;
    s.lock().unwrap().closed = true;
    state.sessions.lock().unwrap().remove(&session);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub mode: String,
    pub color: [u8; 3],
    pub height: [f64; 4],
    pub range: [f64; 2],
}
fn gradient(t: f64) -> [u8; 3] {
    let t = t.clamp(0., 1.);
    [
        (255. * t) as u8,
        (255. * (1. - (2. * t - 1.).abs())) as u8,
        (255. * (1. - t)) as u8,
    ]
}
#[tauri::command]
pub async fn cloud_chunk(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session: String,
    revision: u64,
    start: usize,
    display: Display,
) -> Result<tauri::ipc::Response> {
    let handle = app.state::<Clouds>().session(window.label(), &session)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (c, ids, selection, origin) = {
            let s = handle.lock().unwrap();
            if s.revision != revision {
                return Err("오래된 표시 요청".into());
            }
            (
                s.cloud.clone(),
                s.ids().clone(),
                s.selection.clone(),
                s.origin,
            )
        };
        if start > ids.len() {
            return Err("청크 범위 오류".into());
        }
        let end = (start + CHUNK).min(ids.len());
        let mut out = Vec::with_capacity((end - start) * 20);
        for &id in &ids[start..end] {
            let p = c.positions[id as usize];
            if !process::finite(&p) {
                continue;
            }
            for a in 0..3 {
                let v = (p[a] - origin[a]) as f32;
                if !v.is_finite() {
                    return Err("표시 가능한 좌표 범위를 초과합니다".into());
                }
                out.extend(v.to_le_bytes());
            }
            let rgb = match display.mode.as_str() {
                "rgb" => c.rgb(id).unwrap_or(display.color),
                "height" | "intensity" => {
                    let v = if display.mode == "height" {
                        (0..3).map(|a| p[a] * display.height[a]).sum::<f64>() + display.height[3]
                    } else {
                        c.value(id, "intensity").unwrap_or(f64::NAN)
                    };
                    if v.is_finite() {
                        gradient(
                            (v - display.range[0])
                                / (display.range[1] - display.range[0]).max(f64::EPSILON),
                        )
                    } else {
                        [128, 128, 128]
                    }
                }
                _ => display.color,
            };
            out.extend(rgb);
            out.push(u8::from(selection.binary_search(&id).is_ok()));
            out.extend(id.to_le_bytes());
        }
        Ok(tauri::ipc::Response::new(out))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cloud_point(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session: String,
    point: u32,
) -> Result<serde_json::Value> {
    let h = app.state::<Clouds>().session(window.label(), &session)?;
    tauri::async_runtime::spawn_blocking(move||{let s=h.lock().unwrap();if point as usize>=s.cloud.len()||s.ids().binary_search(&point).is_err(){return Err("표시 중인 점이 아닙니다".into());}
        let fields=s.cloud.values(point).map(|(f,b)|{let values=b.chunks(f.scalar.size()).take(4096).map(|v|f.scalar.number(v).to_string()).collect::<Vec<_>>();(f.name.clone(),serde_json::json!({"values":values,"count":b.len()/f.scalar.size()}))}).collect::<serde_json::Map<_,_>>();Ok(serde_json::json!({"id":point,"position":s.cloud.positions[point as usize],"fields":fields}))
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session() -> Session {
        let c = Cloud {
            format: codec::Format::Ply,
            fields: vec![],
            comments: vec![],
            bytes: vec![],
            offsets: vec![],
            positions: vec![[0., 0., 0.]; 3],
            editable: true,
            warning: None,
        };
        let ids = Arc::new(vec![0, 1, 2]);
        Session {
            owner: "w0".into(),
            path: "x.ply".into(),
            cloud: Arc::new(c),
            active: ids.clone(),
            saved: ids,
            undo: vec![],
            redo: vec![],
            preview: None,
            selection: Arc::new(vec![]),
            revision: 0,
            origin: [0.; 3],
            closed: false,
        }
    }
    #[test]
    fn history_shares_records_and_bounds_undo() {
        let mut s = session();
        assert!(!s.dirty());
        for _ in 0..25 {
            s.apply(Arc::new(vec![1]));
        }
        assert_eq!(s.undo.len(), 20);
        assert!(s.dirty());
        assert_eq!(s.cloud.len(), 3);
        assert_eq!(s.active.as_slice(), [1]);
    }
    #[test]
    fn sessions_are_window_scoped() {
        let state = Clouds::default();
        state
            .sessions
            .lock()
            .unwrap()
            .insert("c0".into(), Arc::new(Mutex::new(session())));
        assert!(state.session("w1", "c0").is_err());
        assert!(state.session("w0", "c0").is_ok());
        state.close_window("w0");
        assert!(state.session("w0", "c0").is_err());
    }
}
