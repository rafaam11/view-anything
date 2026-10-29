# 설치·업데이트와 Linux GUI 검증 기록

기존 사용자 설치본을 변경하지 않고 GitHub-hosted 일회용 Windows 2022/Ubuntu 22.04에서 실행했다. 시험용 앱 식별자·버전 0.0.1/0.0.2·임시 업데이트 서명 키와 localhost 서버를 사용했다. 운영 키는 읽지 않았고 임시 비밀키는 artifact에 포함하지 않았다.

## 자동 검사와 실제 GUI 구분

릴리스 준비 시 필수 5종 `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run check:bundle`, `cargo test --manifest-path src-tauri/Cargo.toml`을 통과했다. 로컬 JS 567 passed/2 skipped, Rust 51 passed다. Unix 전용 심볼릭 링크 회귀는 Linux CI에서 추가 실행한다.

단위 테스트·타입 검사·번들 검사는 설치나 GUI 검증을 대신하지 않는다. 아래 시험은 실제 NSIS/deb/AppImage를 설치하거나 실행해 WebView를 조작했다. Windows는 CDP 키보드·클릭, Linux 본문 컨트롤은 WebDriver JS 이벤트를 사용했다. Linux GTK 저장창은 X11 마우스 입력, 클립보드는 실제 X11 image/png 데이터로 검증했다. 물리 데스크톱·Wayland·Windows 기본 앱 선택 화면의 조작과는 구분한다.

## Windows

[desktop 40833878121](https://github.com/rafaam11/view-anything/actions/runs/40833878121), 앱 코드 `451bef0`, Windows job 성공. evidence의 results.json은 ok=true, WebView 오류 0개다.

| 흐름 | 확인한 결과 |
| --- | --- |
| NSIS 설치 | 공백이 있는 격리 경로에 무인 설치, 설치 파일에서 추출한 앱과 실제 실행 파일 SHA-256 일치 |
| 파일 연결 | 앱 전용 클래스와 인수가 인용된 실행 명령, 공백·한글 TXT/PNG/PDF/PCD를 ShellExecuteEx Open With로 열어 본문·픽셀 크기·PDF 텍스트·8점 표시 확인 |
| 업데이트 오류 | localhost HTTP 503와 잘못된 서명을 실제 updater가 거부, 정상 서명으로 재시도 가능 |
| 미저장 보호 | 다른 TXT 창을 편집한 채 재시작 확인, 모든 창의 Ctrl+S·열기 차단, 취소 후 편집 유지·잠금 해제·BOM/CRLF 저장 |
| 실제 업데이트 | 서명된 0.0.2 NSIS 설치, 이전 프로세스 종료·설치 바이너리 해시·자동 시작 확인, 계측 재실행에서 버전 0.0.2 확인, 저장 원문·파일 연결 유지 |
| 제거 | 실행 파일·현재 클래스·백업 제거, 최초 TXT 연결 복원, 설치 후 다른 앱으로 변경한 LOG 연결 유지, 실행 명령이 같은 구버전 클래스의 MD 백업 이관·복원 |

자동 시작은 설치 경로의 프로세스로 확인했다. NSIS RunAsUser가 계측 환경 변수를 전달하지 않을 수 있어 자동 시작 후 같은 설치 파일을 계측 재실행하고 앱 버전을 확인했다. Windows UserChoice 해시는 변경하지 않았다.

## Linux

[desktop 40835621978](https://github.com/rafaam11/view-anything/actions/runs/40835621978), 시험 코드 `ba433a8`, Linux job 성공. 패키지는 앱 입력 fingerprint가 같은 40833878121의 산출물을 검증 후 재사용했다. evidence의 results.json은 ok=true, 기록한 WebView 오류 0개다. v0.11.0 릴리스 준비에서는 이후 버전·문서만 변경했다.

Ubuntu 22.04, WebKitGTK, Xvfb `:99`, Openbox, Mesa 소프트웨어 렌더러와 Noto CJK 글꼴에서 실행했다. deb와 AppImage **각각** 다음 흐름을 통과했다.

| 흐름 | 확인한 결과 |
| --- | --- |
| TXT와 설정 | 실제 WebView 편집·저장, UTF-8 BOM·CRLF 바이트 일치, 현재 TXT에 맞는 일반/텍스트/현재 파일 설정 |
| 이미지 | 회전·undo/redo, 원본 160×80에서 회전 결과 80×160의 실제 X11 PNG 클립보드 데이터 확인 |
| PDF | 실제 페이지 렌더링, 검색어 needle 강조 표시 |
| 점군과 메시 | Rust PCD 파싱 후 8점 표시, 12삼각형 STL 큐브 표시를 화면에서도 확인 |
| HTML | 실제 GTK 저장창의 기본 경로·파일명으로 저장 버튼 클릭, 생성 HTML 재열기·장면 표시·표준 방향 단축키와 화면 확인 |
| 제거 | deb 제거 후 설치 실행 파일이 남지 않음 |

WebKitWebDriver의 스크린샷 RPC는 모달·가속 WebView에서 멈춰 실제 X11 화면을 scrot으로 캡처했다. 저장창은 기본 파일명으로 저장해 Ctrl+L의 위치 이동과 파일명 편집을 혼동하지 않게 했다. AppImage 런처와 WebKit 자동화 세션의 잔여 프로세스는 파일마다 새 소유 프로세스 그룹으로 분리해 정리했다. GUI 증거의 이미지·PDF·점군·큐브·오프라인 HTML을 직접 열어 검토했다.

## 남은 검증 범위와 후속 제안

- 물리 Linux 데스크톱·Wayland, Windows 기본 앱 선택 UI와 시스템 전체 관리자 설치는 별도 수동 회귀 대상으로 남긴다. 현재 시험은 지원 환경을 명시한 재실행 가능한 패키지 회귀다.
- 구버전에서 이미 덮어쓴 파일 연결 백업·다른 앱의 전역 클래스 내용은 복원할 수 없다. 새 버전은 이후 반복 업데이트에서 백업을 보존한다.
- 다음 제품 단계는 **대용량 읽기와 폴더 성능**을 제안한다. 먼저 합성 TXT 10/100 MiB와 이미지 1만 개의 최초 표시·검색 취소·스크롤 지연·피크 메모리를 양 OS에서 측정한다. 그 결과로 100 MiB 읽기 전용 스트리밍과 썸네일 가상화를 각각 설계한다. 편집의 기존 안전 한도와 기본 본문 중심 UI는 유지하며, 가상화된 썸네일 DOM 수·캐시 예산·응답 시간 목표를 구현 전에 수치로 정한다.
