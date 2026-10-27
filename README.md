# view-anything

더블클릭하면 바로 열리는 가벼운 파일 뷰어입니다. Tauri 2로 만들었습니다.

Markdown, 3D 모델과 포인트클라우드를 지원합니다. Windows와 Linux에서 사용할 수 있습니다.

- **Markdown**: 렌더링된 화면으로 읽고, Typora처럼 화면에서 바로 편집합니다. Mermaid, KaTeX, 목차를 지원합니다.
- **3D**: STEP, IGES, STL, OBJ, PLY, glTF, GLB. 드래그로 같은 장면에 추가하고, 좌표계·단면·표시 모드를 조정하거나 단일 HTML로 공유합니다.
- **포인트클라우드**: PCD/PLY. 원본 RGB·높이·intensity 표시, 점 속성 조회, 박스·관통 다각형 선택, Voxel/SOR/반경 필터를 지원합니다. 원본 속성을 보존하며 같은 형식으로 다른 이름 저장합니다.
- **테마**: 우측 상단 창 버튼 왼쪽의 버튼으로 다크 → 라이트 → 시스템 순서로 바꿉니다. 설정을 기억하고 열린 창에 동기화합니다.
- **예정**: LAS/LAZ, JSON, YAML, CSV, 이미지, PDF.

포인트클라우드는 장면 원본 점 합계 1천만, 디코딩 2GiB/파일, 예상 작업 메모리 8GiB/앱까지 받습니다. 필터는 **미리보기 → 결과 적용** 순서이며, 최대 20회 실행 취소/다시 실행을 지원합니다. 원본은 덮어쓰지 않습니다. HTML 공유에는 점·색상·크기만 포함되며 사용자 정의 속성이나 편집/PCD·PLY 저장 기능은 포함되지 않습니다.

> 개발 초기 단계입니다. 설계는 [docs/superpowers/specs](docs/superpowers/specs/2026-10-26-view-anything-design.md)를 참고하세요.

## 개발

```sh
npm install
npm run tauri dev
```

## 릴리스 노트

- [v0.2.0](docs/release/v0.2.0.md) — 최신
- [v0.1.0](docs/release/v0.1.0.md)
