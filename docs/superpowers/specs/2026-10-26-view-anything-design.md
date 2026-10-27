# view-anything — 설계 및 1차 실행 계획

## Context
VS Code로 md를 보면 무겁고, 미리보기를 따로 켜야 하고, 렌더링 품질도 아쉽다. 읽다가 고치려면 화면을 오가야 해서 불편하다. STEP처럼 전용 뷰어가 없는 3D 파일은 아예 열 수 없다.
그래서 **탐색기에서 더블클릭하면 메모장처럼 바로 열리는 가벼운 범용 뷰어**를 만든다. 3D는 앱에서 바로 열 수 있고, 앱이 없는 동료도 볼 수 있도록 단일 HTML로 내보낼 수 있게 한다.
`D:\dev\view-anything`는 빈 폴더이고 아직 git도 없다. 개인 public GitHub 레포(계정 `rafaam11`)로 개발하며, 버전 관리는 multi-cli-work 방식을 따른다.

## 목표 / 비목표 / 안티목표
- **목표**
  - 더블클릭하고 1초 안팎에 렌더링된 화면이 뜬다.
  - md는 읽기 모드와 WYSIWYG 편집 모드를 분리한다.
  - 3D는 여러 형식을 열고, 드래그로 다른 파일을 같은 장면에 append할 수 있다.
  - 3D 장면을 단일 HTML로 내보낼 수 있다.
- **비목표 (지금은 하지 않음)**
  - AI용 요약 내보내기(사용자가 보류함)
  - 3D 편집이나 메시 가공
  - macOS 지원
  - 탭 UI
- **안티목표 (이렇게 되면 실패)**
  - VS Code처럼 무겁고 느리게 뜨는 것
  - 편집 후 저장했을 때 md 원문 서식이 마음대로 바뀌는 것(불필요한 diff)
  - 읽기 모드에서 실수로 내용이 수정되는 것

## 사용자가 결정한 사항
- **스택:** Tauri 2 (Rust + WebView2) + 웹 프런트엔드
- **창:** 파일마다 새 창(메모장식). 탭은 쓰지 않는다.
- **배포:** Windows(NSIS) + Linux(deb, AppImage). 설치할 때 파일 연결을 등록한다.
- **테마:** 기본은 시스템 설정. 커스텀 제목 표시줄의 최소화 버튼 바로 왼쪽에 테마 버튼 하나를 두고 **다크 → 라이트 → 시스템** 순서로 순환한다(`Ctrl+Shift+T`도 동일). 설정은 재시작 후에도 유지하고 열린 창에 동기화한다. 창 드래그·더블클릭 최대화와 최소화/복원/닫기를 제공하며, 닫기는 미저장 작업 확인을 거친다. md는 Typora/Notion처럼 문서 중심 레이아웃으로 한다.
- **md**
  - 지원: GFM(코드 하이라이트, 표), Mermaid, KaTeX, 목차 사이드바, 상대경로 이미지, 다른 md로 가는 링크는 같은 창에서 열기
  - 편집: WYSIWYG(Typora 스타일). 읽기 전용 모드와 편집 모드를 명확히 분리한다.
- **3D**
  - 지원 형식: STEP, IGES, STL, OBJ, PLY, glTF, GLB
  - 더블클릭하면 앱 뷰어로 열린다.
  - 다른 파일을 끌어다 놓으면 **현재 장면에 append**된다(Meshmixer 방식).
  - "HTML 내보내기" 버튼으로 오프라인에서도 열리는 단일 HTML 파일을 만든다. 용도는 앱이 없는 동료와 공유하거나 내 PC에서 빠르게 확인하는 것.
- **이후 단계:** 포인트클라우드(PCD, LAS), JSON/YAML/CSV, 이미지, PDF
- **진행 순서:** md → 3D(메시 + STEP/IGES) → 포인트클라우드 → 나머지 형식

## 리뷰 후 확정 사항
- **[사용자]** md 원문 보존: 저장할 때 **고친 블록만 diff가 생겨야 한다**.
  - 에디터 문서의 블록마다 원문 위치(mdast position)를 추적한다.
  - 저장할 때는 바뀐 블록만 다시 직렬화해서 원문의 해당 범위에 덮어쓴다.
  - 바뀌지 않은 블록과 frontmatter, HTML 블록은 원문 바이트를 그대로 유지한다.
  - 이 구조는 v0.1의 핵심 리스크이므로 가장 먼저 스파이크로 검증한다(Milkdown으로 할지, 직접 ProseMirror를 쓸지도 이 스파이크 결과로 정한다).
- **[사용자]** 편집 모드에서 Mermaid, 수식, 코드블록은 Typora처럼 동작한다. 커서가 들어가면 원문으로 바뀌고, 벗어나면 다시 렌더링된다.
- **[사용자]** 3D append는 **단위와 축을 변환하지 않고** 파일의 좌표 값을 그대로 쓴다. 이것이 기본 동작이다.
- **[사용자]** 업계에서 통용되는 좌표계 프리셋 중에서 고를 수 있게 한다.
  - 화면 기준 좌표계를 고를 수 있다. 화면에 보이는 up 축과 그리드·축 표시가 이에 따라 바뀐다.
  - 객체마다 원본 좌표계와 단위를 지정할 수 있다. 기본값은 "그대로"이며, 지정하면 화면 기준 좌표계로 변환한다.
  - **[내 판단]** 프리셋 목록:
    - Z-up 오른손(CATIA/NX/Creo/STEP 관례)
    - Y-up 오른손(glTF/Maya/SolidWorks)
    - ROS REP-103(X 앞, Y 왼쪽, Z 위, 단위 m)
    - Y-up 왼손(Unity)
    - Z-up 왼손(Unreal)
    - 단위: mm, cm, m, inch
  - **[내 판단]** HTML 내보내기는 화면에 보이는(변환된) 상태 그대로를 담는다.
- **[내 판단]** 파일 연결: Windows 정책상 설치 프로그램은 "연결 프로그램" 목록에 등록하는 데까지만 할 수 있다. 기본 앱 지정은 사용자가 한 번 직접 한다. 코드 서명은 하지 않으며, SmartScreen 경고는 감수한다.
- **[내 판단]** 프로세스 구조: single-instance로 띄우고 파일마다 새 창을 연다. 두 번째 파일부터 빨리 열리게 하기 위해서다. 1초 목표는 Windows에서 첫 실행 기준이다. Linux는 동작만 하면 된다.
- **[내 판단]** HTML 내보내기
  - 앱 3D 뷰어 코드를 공유 모듈로 만들어 HTML에서도 쓴다. 객체 목록, 표시/숨김, 표준 뷰가 들어간다.
  - meshopt로 압축한다.
  - 크기 상한은 두지 않고, 50MB를 넘으면 경고만 띄운다.

## 마일스톤
| 버전 | 내용 |
|---|---|
| v0.1.0 | 앱 골격, md 읽기·편집, 파일 연결, CI와 릴리스 파이프라인 |
| v0.2.0 | 3D 뷰어(STL/OBJ/PLY/glTF/GLB + STEP/IGES, occt-import-js wasm를 Worker에서), 드래그 append, 장면 트리, 좌표계 프리셋, 표시 모드·치수·단면, 단일 HTML 내보내기, 자동 업데이트 |
| v0.3.0 | 포인트클라우드(PCD/LAS) 뷰어와 처리(Open3D/PCL급 처리 기능: 다운샘플링, 필터링 등). **계획 예정, 인터뷰 필요** |
| v0.4.0 | JSON/YAML(트리 뷰), CSV(표), 이미지 뷰어(꿀뷰처럼 가벼운 PNG/JPG 등 보기), PDF(pdf.js). **계획 예정** |

> 2026-10-27 조정: STEP/IGES를 v0.2.0으로 당기고(원래 v0.3.0), 포인트클라우드를 v0.3.0, 나머지 형식을 v0.4.0으로 옮겼다. 자동 업데이트는 v0.2.0에 넣는다.

## 아키텍처 (빌더 판단에 맡긴 부분은 [제안]으로 표시)
- **진입점:** `view-anything.exe <path>`를 실행하면 확장자로 뷰어 모듈을 고른다.
  - 뷰어는 확장자 → 모듈 레지스트리로 연결해서, 이후 형식은 모듈만 추가하면 되게 한다.
  - 인자 없이 실행하면 "파일 열기 / 여기에 드롭" 화면을 보여준다.
- **프런트엔드:** [제안] Vite + TypeScript + Svelte 또는 vanilla. 초기 로드를 가볍게 하려고 React는 쓰지 않는다. 뷰어 모듈은 lazy import한다(md를 열 때 three.js를 로드하지 않음).
- **md**
  - [제안] 편집은 Milkdown(ProseMirror + remark 기반)을 쓴다. 원문 보존 요구 때문에 remark-stringify 옵션을 원문 스타일에 맞추고, 저장 전 diff 검증 테스트를 둔다.
  - 읽기 모드는 같은 문서를 readonly로 렌더링한다.
  - 하이라이트는 Shiki 또는 highlight.js, 여기에 mermaid와 katex를 더한다.
- **3D**
  - three.js와 three의 로더(STL/OBJ/PLY/GLTF)를 쓰고, STEP/IGES는 occt-import-js(wasm)로 읽는다.
  - 장면 패널에 파일별 객체 목록을 둔다(표시/숨김, 제거, 이름). append한 객체는 원래 좌표 값을 변환 없이 그대로 쓴다.
  - 카메라 조작: 회전/팬/줌, 전체 맞춤, 표준 뷰.
- **HTML 내보내기**
  - 장면 전체를 GLB로 직렬화하고(three GLTFExporter, meshopt/draco 압축은 [제안]), 템플릿 HTML 안에 three.js 번들과 함께 base64로 넣는다.
  - 결과물은 외부 요청이 없는 단일 파일이어야 한다.
- **Rust 측:**
  - 파일 읽기와 쓰기(md 저장)
  - 인자 처리
  - 파일 드롭 이벤트
  - 외부 링크를 기본 브라우저로 열기
  - 파일 연결 등록: tauri.conf의 `fileAssociations`

## 저장소와 버전 관리 (multi-cli-work 방식)
- **버전 체계:** SemVer `vX.Y.Z`, 0.1.0부터 시작한다. 기능 추가는 minor, 수정은 patch를 올린다.
- **버전 위치:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` 세 곳을 함께 올린다. [제안] multi-cli-work와 달리 버전이 세 곳에 있어 불일치를 막아야 하므로 `scripts/bump-version.mjs`를 둔다.
- **릴리스 커밋:**
  - 커밋 메시지는 `chore: prepare vX.Y.Z release`로 한다.
  - 이 커밋에서 위 세 파일을 수정하고, `docs/release/vX.Y.Z.md`를 새로 만들고, README의 최신 릴리스 노트 링크를 갱신한다.
- **릴리스 노트 형식:** `# vX.Y.Z — 한 줄 요약`, 요약 문단, `- **항목**: 설명` 목록 순으로 쓴다(한국어).
- **태그:** 경량 태그 `vX.Y.Z`를 릴리스 커밋에 붙인다.
- **CI**
  - `.github/workflows/ci.yml`: PR과 main 푸시에서 lint, test, build를 돌린다.
  - `.github/workflows/release.yml`: `v*` 태그에서 실행한다. 순서는 verify-version(세 파일 모두 비교) → windows-2022(NSIS)·ubuntu-22.04(deb, AppImage) 빌드 → softprops/action-gh-release로 **draft** 릴리스.
- **커밋 규칙:** Conventional Commits, scope 없이, 영어 소문자 명령문으로 쓴다. main에 바로 커밋한다.
- **프로젝트 문서:** AGENTS.md가 source of truth이고, CLAUDE.md는 `@AGENTS.md` 한 줄만 둔다.

## 1차 실행 범위 (이 계획 승인 후)
1. **저장소 만들기**
   - `git init`을 하고 Tauri 2 골격을 생성한다(`npm create tauri-app`).
   - AGENTS.md, CLAUDE.md, README, `.gitignore`를 만든다.
   - 설계 문서를 `docs/superpowers/specs/2026-10-26-view-anything-design.md`로 커밋한다.
2. **GitHub public 레포 만들기:** `gh repo create rafaam11/view-anything --public`로 만들고 push한다. ※ 외부에 공개되는 작업이라 실행 직전에 한 번 더 확인한다.
3. **v0.1.0 구현 계획:** superpowers:writing-plans로 v0.1.0(md 뷰어와 편집기, 파일 연결, CI와 릴리스)의 상세 구현 계획을 작성한 뒤 구현한다.

## 검증
- `npm run tauri dev`로 띄운 뒤, 샘플 md(표, 코드, mermaid, katex, 상대 이미지 포함)가 정상 렌더링되는지 확인한다.
- 편집 모드에서 아무것도 바꾸지 않고 저장했을 때 원문과 바이트 단위로 같은지 확인하고, 이를 자동 테스트로 둔다.
- NSIS 설치 후 탐색기에서 `.md`를 더블클릭해 창이 뜨는지, 콜드 스타트 시간이 얼마인지 측정한다.
- 태그를 푸시하면 release.yml이 draft 릴리스를 만드는지 확인한다(버전 불일치 시 실패하는지도 확인).
- v0.2 이후: STL과 STEP을 순서대로 드롭했을 때 append되는지 확인한다. 내보낸 HTML을 네트워크를 끈 브라우저에서 열어 확인한다.
