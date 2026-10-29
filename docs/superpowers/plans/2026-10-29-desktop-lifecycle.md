# 설치·업데이트와 Linux GUI 회귀

사용 중인 Windows 설치본을 변경하지 않고 GitHub-hosted 일회용 실행 환경에서 시험한다. `desktop` workflow를 수동 실행하며, self-hosted 또는 일반 사용자 PC에서는 설치 스크립트가 실행을 거부한다. 앱 의존성과 분리된 `scripts/desktop/`에 시험 도구를 둔다.

## 시험 구성

- Windows: 현재 코드로 버전 0.0.1/0.0.2 NSIS를 만들고 설치·파일 연결 등록·Open With 실행·잘못된 업데이트 서명·미저장 창 보호·업데이트 취소/재시도·실제 업데이트/재시작·제거를 검증한다. 폴더·파일 경로의 공백과 한글도 포함한다.
- 시험용 앱 식별자와 임시 서명 키, localhost 업데이트 서버만 사용한다. 비밀키는 RUNNER_TEMP에만 생성하고 키/설치 파일은 증거 artifact에 넣지 않는다. 운영 키·GitHub Secrets·공개 릴리스·latest.json을 변경하지 않는다.
- Windows 등록 명령은 실제 ShellExecuteEx의 Open With 클래스 호출로 검사한다. Windows의 사용자 기본 앱 선택(UserChoice)을 강제로 변경하지 않으며 탐색기 기본 앱 선택 화면까지 검증했다고 보고하지 않는다.
- Linux: 실제 deb 설치본과 AppImage를 WebKitGTK/WebDriver, Xvfb, Mesa 소프트웨어 렌더러에서 실행한다. TXT 안전 저장·설정, 이미지 이력·X11 이미지 클립보드, PDF 검색, PCD/STL 표시, GTK 저장 대화상자로 HTML 내보내기와 재열기를 확인한다. 물리 데스크톱·Wayland 검증과 구분한다.
- 실패해도 GUI 화면·도구 로그·완료한 단계/실패 이유를 artifact로 남긴다. 통과 결과만 통과로 표시한다.
- `platform`으로 양 OS 또는 하나를 선택한다. `package_run`에 앞선 실행 번호를 지정하면 패키지를 재사용해 시험 스크립트만 다시 검사할 수 있다. 현재 src/src-tauri/vendor·버전/빌드 입력의 내용 fingerprint와 OS가 패키지 manifest와 일치하지 않으면 실행을 거부한다. packages artifact에는 공개 시험 설정·설치 파일·서명만 포함하고 임시 비밀키는 제외한다.

## 검토 중 발견한 수정

업데이트 잠금은 앱의 window capture 단축키보다 먼저 등록한다. 잠금 중 다른 창에서 Ctrl+S·열기 요청이 실행되지 않아야 하며 취소하면 편집을 유지한 채 해제한다. 설정 대화상자도 잠근다.

NSIS의 파일 연결 클래스는 `Image`, `PDF` 같은 전역 이름 대신 앱 식별자로 구분한다. 다른 앱의 같은 이름 클래스를 덮어쓰지 않도록 하고 파일 유형 설명은 사람이 읽는 이름으로 유지한다.

## 완료 기준

필수 검증 5종, 일반 Windows/Linux CI와 desktop 양 OS 실제 패키지 시험을 모두 확인한다. GUI 자동 조작·실제 네이티브 파일/클립보드/설치 경로와 단위 테스트를 구분해 결과를 기록한다. 이번 단계는 공개 릴리스 발행을 포함하지 않는다.

참고: [Tauri WebDriver 설치](https://v2.tauri.app/develop/tests/webdriver/manual-setup/), [업데이트 서명·NSIS 동작](https://v2.tauri.app/plugin/updater/), [NSIS 파일 연결 구현](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/FileAssociation.nsh).
