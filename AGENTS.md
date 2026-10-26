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

## 꼭 지킬 것
- md 저장 시 **고친 블록만** 원문에 반영한다. 손대지 않은 블록과 frontmatter는 바이트 단위로 보존해야 하며, 이를 회귀 테스트로 지킨다.
- 읽기 모드와 편집 모드를 분리한다. 읽기 모드에서는 내용이 바뀌면 안 된다.
- 3D 좌표는 기본적으로 파일 값을 그대로 쓴다. 변환은 사용자가 좌표계 프리셋을 지정했을 때만 한다.
- 시작 속도가 핵심 가치다. 무거운 의존성을 추가할 때는 초기 번들에 들어가지 않게 한다.

## 버전·릴리스 (multi-cli-work 방식)
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
