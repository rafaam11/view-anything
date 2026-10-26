# view-anything

더블클릭하면 바로 열리는 가벼운 파일 뷰어입니다. Tauri 2로 만들었습니다.

현재(v0.1) 지원 형식은 **Markdown**뿐입니다.

- **Markdown**: 렌더링된 화면으로 읽고, Typora처럼 화면에서 바로 편집합니다. Mermaid, KaTeX, 목차를 지원합니다.
- **예정**
  - 3D: STEP, IGES, STL, OBJ, PLY, glTF, GLB (드래그로 같은 장면에 추가, 단일 HTML 내보내기)
  - 포인트클라우드(PCD, LAS), JSON, YAML, CSV, 이미지, PDF

> 개발 초기 단계입니다. 설계는 [docs/superpowers/specs](docs/superpowers/specs/2026-10-26-view-anything-design.md)를 참고하세요.

## 개발

```sh
npm install
npm run tauri dev
```

## 릴리스 노트

아직 릴리스가 없습니다.
