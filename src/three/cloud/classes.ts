/** ASPRS LAS 1.4 point classes 0-22 for the colour legend. Rust `classification_color` paints the same colours. */
export interface PointClass { code: number; name: string; rgb: [number, number, number] }

export const CLASSES: PointClass[] = [
  { code: 0, name: "미분류", rgb: [128, 128, 128] },
  { code: 1, name: "분류 안 됨", rgb: [180, 180, 180] },
  { code: 2, name: "지면", rgb: [139, 90, 43] },
  { code: 3, name: "낮은 식생", rgb: [152, 251, 152] },
  { code: 4, name: "중간 식생", rgb: [60, 179, 113] },
  { code: 5, name: "높은 식생", rgb: [34, 139, 34] },
  { code: 6, name: "건물", rgb: [205, 92, 92] },
  { code: 7, name: "낮은 잡음", rgb: [255, 0, 255] },
  { code: 8, name: "예약", rgb: [255, 215, 0] },
  { code: 9, name: "물", rgb: [30, 144, 255] },
  { code: 10, name: "철도", rgb: [160, 82, 45] },
  { code: 11, name: "도로면", rgb: [105, 105, 105] },
  { code: 12, name: "예약(겹침)", rgb: [255, 255, 0] },
  { code: 13, name: "전선 보호", rgb: [255, 160, 122] },
  { code: 14, name: "전선", rgb: [255, 69, 0] },
  { code: 15, name: "송전탑", rgb: [138, 43, 226] },
  { code: 16, name: "전선 연결부", rgb: [255, 105, 180] },
  { code: 17, name: "교량 상판", rgb: [210, 105, 30] },
  { code: 18, name: "높은 잡음", rgb: [255, 0, 0] },
  { code: 19, name: "고가 구조물", rgb: [72, 61, 139] },
  { code: 20, name: "무시된 지면", rgb: [189, 183, 107] },
  { code: 21, name: "눈", rgb: [240, 248, 255] },
  { code: 22, name: "시간 제외", rgb: [112, 128, 144] },
];

/** Every other code (23-255, user-defined classes) shares one grey. */
export const OTHER_CLASS = { name: "그 외", rgb: [200, 200, 200] as [number, number, number] };
