# view-anything

탐색기에서 더블클릭하면 메모장처럼 바로 열리는 가벼운 범용 뷰어.
Markdown(읽기 + Typora식 WYSIWYG 편집)과 3D(STEP/IGES/STL/OBJ/PLY/glTF/GLB, 드래그 append, 단일 HTML 내보내기)를 우선 지원하고,
포인트클라우드·JSON/YAML/CSV·이미지·PDF로 확장한다.

- 설계: `docs/superpowers/specs/2026-10-26-view-anything-design.md` (결정 사항의 source of truth)
- 소통·문서는 한국어. 코드 식별자와 커밋 메시지는 영어.

## 스택
- Tauri 2 (Rust, `src-tauri/`) + Vite + TypeScript vanilla 프런트엔드 (`src/`)
- 뷰어는 확장자 → 모듈 레지스트리로 연결하고 lazy import한다. md를 열 때 three.js를 로드하지 않는다.
- 대상 OS: Windows(NSIS), Linux(deb, AppImage). macOS는 비목표.

## 개발
- `npm install` → `npm run tauri dev`
- 빌드: `npm run tauri build`
- 검증: `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run check:bundle`, `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build:runtime`: HTML 내보내기용 뷰어 런타임(`vite.runtime.config.ts` → `build/runtime/va-runtime.js`, IIFE 한 파일)을 빌드한다. `build`와 `predev`가 먼저 실행하므로 보통 직접 돌릴 일은 없다. 앱의 내보내기 코드가 이 파일을 `?raw`로 인라인하므로 앱 빌드 전에 있어야 한다.
- 측정 스크립트(커밋하지 않는 데이터만 만든다): `node scripts/bench-stl.mjs [삼각형 수]`(임시 폴더에 합성 바이너리 STL을 만들어 parseMesh 시간 측정), `node scripts/bench-edges.mjs [삼각형 수]`(엣지 추출 시간, three EdgesGeometry와 결과 비교).

## 3D 모듈 구조 (`src/three/`)
- `formats.ts`: 확장자 판별, 바이너리 STL 판별. three를 import하지 않는다(진입 청크에서 쓴다).
- `viewer.ts`: 앱 3D 뷰어(레지스트리가 lazy import). 파일 큐, 드롭·append, 패널, 메뉴바, 진행률·배너. Tauri(`platform.ts`)를 쓰는 앱 전용 코드다.
- `load.ts`, `io/source.ts`: 파일 읽기(asset 프로토콜 병렬 Range 요청, 실패 시 `read_file_raw`). glTF는 UI 스레드의 GLTFLoader, 나머지는 파싱 워커.
- `worker/`: Web Worker 코드.
  - `parse.worker.ts` + `parse-mesh.ts`(STL/OBJ/PLY) + `occt.ts`(STEP/IGES, occt-import-js wasm를 이 형식일 때만 동적 import). `protocol.ts`는 양쪽이 쓰는 순수 메시지 정의.
  - `geometry.worker.ts`: 엣지 선과 BVH를 만든다. UI 쪽 러너는 `geometry-worker.ts`이고, 작업 큐는 `core/geometry-jobs.ts`다. 우선순위는 pick → edges → prebuild 순이다. 파일을 지우면 실행 중인 작업의 워커를 종료하고, 워커를 쓸 수 없으면 5만 삼각형 넘는 작업은 UI 스레드에서 돌리지 않는다.
- `core/`: **Tauri 없는 공용 코어.** 앱 뷰어와 HTML 내보내기 런타임이 함께 쓴다. stage(카메라·조작·그리드), scene-model·panel(트리), frames(좌표계 프리셋·단위), display-modes·fast-edges·clipping·info·view-tools(표시 모드, 엣지, 단면, 치수, 커서 좌표), menubar·view-menu·keys.
- `export/`: 파일 > HTML로 내보내기(GLTFExporter → meshopt 압축 워커 → 단일 HTML 템플릿). 앱에서만 lazy import한다.
- `export-runtime/main.ts`: 내보낸 HTML 안에서 도는 뷰어. 공용 코어와 Tauri 없는 geometry 워커 러너를 쓴다. 워커는 단일 HTML에 인라인되며 CSP `worker-src blob:`으로 실행한다. Tauri를 참조하면 안 된다.

## 3D 코드 규칙
- `core/`, `worker/`, `export-runtime/`, `io/source.ts`는 `platform.ts`나 `@tauri-apps/*`를 import하지 않는다.
- 진입 청크와 md 뷰어 청크는 three와 occt를 정적으로 참조하지 않는다. `scripts/check-bundle.mjs`(`npm run check:bundle`, `npm run build` 뒤 실행)가 이를 검사하고, 런타임 번들(`build/runtime/va-runtime.js`)이 있는지, Tauri 참조나 ES 모듈 구문이 없는지도 확인한다.
- 무거운 계산(파싱, 엣지, BVH, 압축)은 워커에서 한다. UI 스레드에서는 작은 메시만 처리하고, 큰 GPU 업로드는 청크로 나눠 한 프레임에 하나씩 올린다.
- 파일을 제거하면 geometry, material, texture, 엣지 선, BVH를 모두 dispose한다(`tests/three-viewer-append.test.ts`의 dispose 점검 테스트).
- 부품 이름 같은 파일 유래 문자열은 textContent로만 표시한다.

## 꼭 지킬 것
- md 저장 시 **고친 블록만** 원문에 반영한다. 손대지 않은 블록과 frontmatter는 바이트 단위로 보존해야 하며, 이를 회귀 테스트로 지킨다.
- 읽기 모드와 편집 모드를 분리한다. 읽기 모드에서는 내용이 바뀌면 안 된다.
- 3D 좌표는 기본적으로 파일 값을 그대로 쓴다. 변환은 사용자가 좌표계 프리셋을 지정했을 때만 한다.
- 시작 속도가 핵심 가치다. 무거운 의존성을 추가할 때는 초기 번들에 들어가지 않게 한다.

## 버전·릴리스 (multi-cli-work 방식)
- 자동 업데이트: `src/update/`(상태·배지·다중 창 저장 보호), `src-tauri/src/update.rs`(프로세스당 관리 창). updater/process JS는 lazy import한다. `scripts/make-latest-json.mjs`가 서명된 NSIS/AppImage에서 manifest를 만든다. 공개키만 설정에 넣고 비밀키·비밀번호는 레포 밖 또는 GitHub Secrets에 둔다.
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
