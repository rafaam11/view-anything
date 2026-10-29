# view-anything

탐색기에서 더블클릭하면 메모장처럼 바로 열리는 가벼운 범용 뷰어.
Markdown(읽기 + Typora식 WYSIWYG 편집), 3D(STEP/IGES/STL/OBJ/PLY/glTF/GLB, 드래그 append, 단일 HTML 내보내기),
포인트클라우드(PCD/PLY/LAS/LAZ 검사·정리·원본 속성 보존 저장 및 강체 ICP), 이미지, JSON/YAML/CSV와 PDF를 지원한다.

- 설계: `docs/superpowers/specs/2026-10-26-view-anything-design.md` (결정 사항의 source of truth)
- 소통·문서는 한국어. 코드 식별자와 커밋 메시지는 영어.

## 스택
- Tauri 2 (Rust, `src-tauri/`) + Vite + TypeScript vanilla 프런트엔드 (`src/`)
- 뷰어는 확장자 → 모듈 레지스트리로 연결하고 lazy import한다. md를 열 때 three.js를 로드하지 않는다.
- PDF 뷰어(`src/pdf/`)는 읽기 전용이며 PDF.js와 워커를 파일을 열 때만 로드한다. 100MiB 제한, 현재 페이지만 렌더링하며 텍스트 선택·검색 강조·목차를 제공한다. 암호는 입력 중에만 보관하고 저장하거나 로그에 남기지 않는다.
- 대상 OS: Windows(NSIS), Linux(deb, AppImage). macOS는 비목표.

## 창과 테마
- `src/titlebar.ts`와 `titlebar.css`가 앱 전용 커스텀 제목 표시줄을 만든다. Rust `create_window`는 `decorations(false)`로 연다. 닫기는 `close()` 요청을 사용해 미저장 작업 확인을 거치며, 강제 `destroy()`로 바꾸지 않는다.
- 최소화 왼쪽 테마 버튼과 `Ctrl+Shift+T`는 다크 → 라이트 → 시스템 순으로 순환한다. `va.theme`에 저장하고 열린 창에도 동기화한다.
- `--va-titlebar-height` 아래의 `#app`이 스크롤 컨테이너다. Markdown 목차·스크롤 복원도 이 컨테이너를 따른다. 공용 3D CSS는 높이 변수의 기본값을 0으로 두어 내보낸 HTML에는 앱 제목 표시줄 공간이 생기지 않게 한다.

## 개발
- `npm install` → `npm run tauri dev`
- 빌드: `npm run tauri build`
- 검증: `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run check:bundle`, `cargo test --manifest-path src-tauri/Cargo.toml`
- `desktop` workflow는 Windows NSIS 설치·서명 업데이트·제거와 Linux deb/AppImage의 실제 WebKit GUI를 GitHub-hosted 일회용 runner에서 시험한다. `scripts/desktop/`의 별도 npm 의존성은 앱 번들에 넣지 않는다. 사용자 PC/self-hosted에서는 설치 스크립트가 거부되며 환경 변수를 위조해 우회하지 않는다. 시험 키는 RUNNER_TEMP에만 만들고 packages/evidence artifact에 넣지 않는다. `package_run`으로 기존 시험 패키지를 재사용할 때는 현재 앱 입력의 fingerprint가 일치해야 한다.
- `npm run build:runtime`: HTML 내보내기용 뷰어 런타임(`vite.runtime.config.ts` → `build/runtime/va-runtime.js`, IIFE 한 파일)을 빌드한다. `build`와 `predev`가 먼저 실행하므로 보통 직접 돌릴 일은 없다. 앱의 내보내기 코드가 이 파일을 `?raw`로 인라인하므로 앱 빌드 전에 있어야 한다.
- 측정 스크립트(커밋하지 않는 데이터만 만든다): `node scripts/bench-stl.mjs [삼각형 수]`(임시 폴더에 합성 바이너리 STL을 만들어 parseMesh 시간 측정), `node scripts/bench-edges.mjs [삼각형 수]`(엣지 추출 시간, three EdgesGeometry와 결과 비교).
- 포인트클라우드 측정: `cargo run --release --manifest-path src-tauri/Cargo.toml --example bench-cloud -- 10000000`. OS 임시 폴더의 합성 XYZRGB+ring PCD만 사용한다.
- ICP 측정: `cargo run --release --manifest-path src-tauri/Cargo.toml --example bench-registration -- 1000000 100000`. 합성 배열만 사용하며 인자는 원본 점 수와 표본 상한이다.

## 3D 모듈 구조 (`src/three/`)
- `formats.ts`: 확장자 판별, 바이너리 STL 판별. three를 import하지 않는다(진입 청크에서 쓴다).
- `viewer.ts`: 앱 3D 뷰어(레지스트리가 lazy import). 파일 큐, 드롭·append, 패널, 메뉴바, 진행률·배너. Tauri(`platform.ts`)를 쓰는 앱 전용 코드다.
- `cloud/`: PCD/점 PLY의 앱 전용 지연 로딩 UI. Rust 세션의 25,000점 청크로 표시하며 GPU ID로 원본점을 조회한다. 미리보기/적용/20회 undo·redo/다른 이름 저장과 HTML 내보내기 잠금, 화면 갱신 실패 복구를 관리한다.
- `src-tauri/src/cloud/`: 원본 점 레코드와 f64 좌표, ID 이력을 보관한다. 파싱/선택/필터/저장은 `spawn_blocking`, 이웃 검색은 kiddo + 4스레드 rayon. 계산은 앱 전체 하나씩, 세션은 창 소유. 원본 파일은 덮어쓰지 않는다.
- `src-tauri/src/cloud/registration.rs`: 현재 장면 좌표로 점 대 점 강체 ICP를 계산한다. 소스·기준 점군을 각각 최대 1만·5만·10만 점으로 표본화하고 미리보기 후 명시적으로 적용한다. 정합과 필터의 undo/redo 순서는 프런트에서 통합하고 원본 ID 이력은 Rust에서 보관한다. 정합 저장은 좌표만 변환해 별도 파일에 쓴다. LAS/LAZ 파형·COPC와 정밀도 보존 불가 좌표, 정수 XYZ PCD/PLY 및 기본값이 아닌 PCD VIEWPOINT의 정합 저장은 거부한다.
- `load.ts`, `io/source.ts`: 파일 읽기(asset 프로토콜 병렬 Range 요청, 실패 시 `read_file_raw`). glTF는 UI 스레드의 GLTFLoader, 나머지는 파싱 워커.
- `worker/`: Web Worker 코드.
  - `parse.worker.ts` + `parse-mesh.ts`(STL/OBJ/PLY) + `occt.ts`(STEP/IGES, occt-import-js wasm를 이 형식일 때만 동적 import). `protocol.ts`는 양쪽이 쓰는 순수 메시지 정의.
  - `geometry.worker.ts`: 엣지 선과 BVH를 만든다. UI 쪽 러너는 `geometry-worker.ts`이고, 작업 큐는 `core/geometry-jobs.ts`다. 우선순위는 pick → edges → prebuild 순이다. 파일을 지우면 실행 중인 작업의 워커를 종료하고, 워커를 쓸 수 없으면 5만 삼각형 넘는 작업은 UI 스레드에서 돌리지 않는다.
- `core/`: **Tauri 없는 공용 코어.** 앱 뷰어와 HTML 내보내기 런타임이 함께 쓴다. stage(카메라·조작·그리드), scene-model·panel(트리), frames(좌표계 프리셋·단위), display-modes·fast-edges·clipping·info·view-tools(표시 모드, 엣지, 단면, 치수, 커서 좌표), menubar·view-menu·keys.
- `export/`: 파일 > HTML로 내보내기(geometry 청크 복사·텍스처 스냅샷 → GLTFExporter 워커 → meshopt 압축 워커 → 청크 단위 HTML 조립). 앱에서만 lazy import한다. 워커 실패 시 큰 작업을 UI 스레드로 돌리지 않는다.
- `export-runtime/main.ts`: 내보낸 HTML 안에서 도는 뷰어. 공용 코어와 Tauri 없는 geometry 워커 러너를 쓴다. 워커는 단일 HTML에 인라인되며 CSP `worker-src blob:`으로 실행한다. Tauri를 참조하면 안 된다.

## 3D 코드 규칙
- `core/`, `worker/`, `export-runtime/`, `io/source.ts`는 `platform.ts`나 `@tauri-apps/*`를 import하지 않는다.
- 진입 청크와 md 뷰어 청크는 three와 occt를 정적으로 참조하지 않는다. `scripts/check-bundle.mjs`(`npm run check:bundle`, `npm run build` 뒤 실행)가 이를 검사하고, 런타임 번들(`build/runtime/va-runtime.js`)이 있는지, Tauri 참조나 ES 모듈 구문이 없는지도 확인한다.
- 무거운 계산(파싱, 엣지, BVH, 압축)은 워커에서 한다. UI 스레드에서는 작은 메시만 처리하고, 큰 GPU 업로드는 청크로 나눠 한 프레임에 하나씩 올린다.
- 포인트클라우드는 JS 워커 대신 Rust 백그라운드에서 처리한다. 장면 원본 점 합계 1천만(숨김·편집으로 제거된 원본점도 예약), 디코딩 2GiB/세션, 예상 작업 메모리 8GiB/앱을 제한한다. 실제 OS/GPU 메모리의 하드 상한은 아니다.
- LAS/LAZ는 `vendor/las`의 로컬 패치를 사용한다. 저장 실패 시 writer 정리 과정에서 패닉하지 않게 한 변경과 원본 라이선스는 `vendor/las/PATCH.md`에 기록한다.
- 파일을 제거하면 geometry, material, texture, 엣지 선, BVH를 모두 dispose한다(`tests/three-viewer-append.test.ts`의 dispose 점검 테스트).
- 부품 이름 같은 파일 유래 문자열은 textContent로만 표시한다.

## 이미지·데이터
- 공통 뷰어 메뉴·도구줄은 `src/ui/chrome.ts`/`chrome.css`, 아이콘은 `src/ui/icons.ts`를 쓴다. 앱과 HTML의 메뉴는 `src/ui/menu.css`를 공유하며 Tauri를 참조하지 않는다. 파일명은 제목줄에만 표시하고 저장은 파일 메뉴, 검색·자르기·썸네일은 요청 시 표시한다.
- `src/text/`는 10 MiB까지 일반 텍스트·코드를 읽고 안전 편집한다. UTF 원문/BOM/줄바꿈을 보존하며 혼합 줄바꿈은 읽기 전용이다. CP949는 명시적으로 선택하고 Rust `text_codec.rs`의 무손실 변환을 쓴다. `Ctrl+Shift+O`는 확장자와 무관한 명시적 텍스트 열기다.
- `src/settings/`는 제목줄 설정 버튼과 `Ctrl+,`로 연다. `va.preferences.v1`에 Markdown·텍스트 각각의 글꼴 프리셋·크기와 텍스트 자동 줄바꿈을 저장하고 열린 창에도 동기화한다. 현재 뷰어에 맞는 항목만 제공하며 빈 창은 두 표시 그룹을 제공한다. 본문 CSS 변수와 textarea의 soft/off 줄바꿈으로 읽기·편집에 적용하며 원문과 편집 이력은 바꾸지 않는다. 문자 인코딩은 현재 파일에만 적용하고 표시 설정의 초기화와 분리한다.
- `src/image/`는 원본을 보호하고 편집 결과를 별도 PNG로 저장한다. GIF/SVG 편집은 정적 결과다. 아이콘 도구줄, Ctrl+휠 포인터 기준 확대, 드래그 팬, Ctrl+0 맞춤, Ctrl+C 원본 해상도 이미지 복사를 지원한다. 클립보드에는 raw PNG IPC를 사용하고 Rust 백그라운드에서 디코딩·쓰기한다. 클립보드 읽기 권한은 부여하지 않는다. 자르기·회전은 편집 모드에서만 가능하다.
- `src/data/`는 JSON/YAML 원문, CSV 수정 셀, UTF-8/UTF-16과 줄바꿈을 보존한다. 저장 직전 바이트 확인과 네이티브 조건부 원자 교체를 쓰며, 외부 프로세스와의 검증·교체 사이 경쟁은 완전히 제거할 수 없다.
- CSV는 100행 단위로 표시하고 수정은 저장 시 한 번에 적용한다. Markdown·데이터 복사본 저장은 기존 대상 교체를 거부하며 하드 링크 미지원 파일시스템에서는 실패한다.
- 3D 조작은 `core/navigation.ts`의 Arcball/Fly를 앱과 HTML이 공유한다. 장면 트리와 앱 점군 도구는 오른쪽 통합 패널에 둔다.

## 꼭 지킬 것
- 심플함이 최우선이다. 기본 화면은 본문에 집중하고 인코딩·글꼴 같은 세부 옵션은 설정에 둔다. 검색창은 필요할 때만 열고 저장·다시 읽기는 메뉴로 제공한다.
- md 저장 시 **고친 블록만** 원문에 반영한다. 손대지 않은 블록과 frontmatter는 바이트 단위로 보존해야 하며, 이를 회귀 테스트로 지킨다.
- 읽기 모드와 편집 모드를 분리한다. 읽기 모드에서는 내용이 바뀌면 안 된다.
- 3D 좌표는 기본적으로 파일 값을 그대로 쓴다. 변환은 사용자가 좌표계 프리셋을 지정했을 때만 한다.
- 시작 속도가 핵심 가치다. 무거운 의존성을 추가할 때는 초기 번들에 들어가지 않게 한다.

## 버전·릴리스 (multi-cli-work 방식)
- 자동 업데이트: `src/update/`(상태·배지·다중 창 저장 보호), `src-tauri/src/update.rs`(프로세스당 관리 창). updater/process JS는 lazy import한다. `scripts/make-latest-json.mjs`가 서명된 NSIS/AppImage에서 manifest를 만든다. 공개키만 설정에 넣고 비밀키·비밀번호는 레포 밖 또는 GitHub Secrets에 둔다.
- 업데이트 입력 잠금은 `src/update/guard.ts`의 작은 모듈을 main에서 제목줄·뷰어 단축키보다 먼저 초기화한다. 잠금 중 앱 단축키·열기·드롭·설정 변경을 막고 업데이트 대화상자의 Tab/Enter/Space/Escape만 허용한다. 취소하면 기존 inert 상태와 미저장 편집을 보존해 해제한다. 파일 연결 클래스 이름은 앱 식별자로 구분하며 일반적인 전역 이름으로 바꾸지 않는다.
- Windows NSIS의 `windows/file-associations.nsh` hook은 파일 연결 매크로만 교체한다. 업데이트 시 최초 연결 백업을 보존하고 이후 선택한 다른 앱을 유지하며, 제거 시 우리 클래스가 현재 연결인 경우에만 복원한다. 구버전 클래스 이관은 실행 명령이 동일한 경우로 제한한다. 이 경로의 회귀는 일회용 Windows 설치→서명 업데이트→제거에서 검증한다.
- 버전 체계는 SemVer `vX.Y.Z`. 기능 추가는 minor, 수정만 있으면 patch를 올린다.
- 버전은 `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` 세 곳에 있다. 항상 함께 올린다.
- 버전 스크립트:
  - `node scripts/bump-version.mjs X.Y.Z`: 세 파일과 `src-tauri/Cargo.lock`의 `view-anything` 항목을 함께 갱신한다.
  - `node scripts/check-version.mjs [vX.Y.Z]`: 세 파일 버전이 같은지 검사한다(태그를 넘기면 `v<version>`과도 비교). 불일치 시 exit 1. CI와 release workflow가 사용한다.
- 릴리스 커밋 `chore: prepare vX.Y.Z release`에 포함할 것:
  - 세 버전 파일
  - 새 릴리스 노트 `docs/release/vX.Y.Z.md`
  - README의 최신 릴리스 노트 링크 갱신
- 릴리스 노트 형식(한국어): `# vX.Y.Z — 한 줄 요약`, 요약 문단, `- **항목**: 설명` 목록.
- 태그: 릴리스 커밋에 경량 태그 `vX.Y.Z`를 붙이고 푸시한다. release workflow가 버전을 검증하고 빌드한 뒤 draft 릴리스를 만든다. 공개 발행은 수동으로 한다.
- 커밋 메시지: Conventional Commits, scope 없이 `type: lowercase imperative`. main에 바로 커밋한다.
