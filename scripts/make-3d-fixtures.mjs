// Usage: node scripts/make-3d-fixtures.mjs
// Regenerates the small 3D test fixtures in tests/fixtures/3d/. Output is deterministic and
// committed; rerun only when a fixture needs to change.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";

const out = resolve(fileURLToPath(import.meta.url), "..", "..", "tests", "fixtures", "3d");
mkdirSync(out, { recursive: true });

// Unit cube [0,1]^3: 8 corners, 12 outward-facing triangles.
const V = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const QUADS = [
  [0, 3, 2, 1], // bottom -Z
  [4, 5, 6, 7], // top +Z
  [0, 1, 5, 4], // front -Y
  [2, 3, 7, 6], // back +Y
  [1, 2, 6, 5], // right +X
  [3, 0, 4, 7], // left -X
];
const TRIS = QUADS.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);

function normal([a, b, c]) {
  const [p, q, r] = [V[a], V[b], V[c]];
  const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n);
  return n.map((x) => x / l);
}

// ASCII STL
{
  const lines = ["solid cube"];
  for (const t of TRIS) {
    lines.push(`  facet normal ${normal(t).join(" ")}`, "    outer loop");
    for (const i of t) lines.push(`      vertex ${V[i].join(" ")}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push("endsolid cube", "");
  writeFileSync(join(out, "cube-ascii.stl"), lines.join("\n"));
}

// Binary STL whose header starts with "solid" (common exporter quirk).
{
  const buf = Buffer.alloc(84 + 50 * TRIS.length);
  buf.write("solid binary header written by an exporter", 0, "ascii");
  buf.writeUInt32LE(TRIS.length, 80);
  TRIS.forEach((t, k) => {
    let o = 84 + 50 * k;
    for (const x of normal(t)) (buf.writeFloatLE(x, o), (o += 4));
    for (const i of t) for (const x of V[i]) (buf.writeFloatLE(x, o), (o += 4));
  });
  writeFileSync(join(out, "cube-binary.stl"), buf);
}

// OBJ with o/g structure: Body (own faces + groups Lid and Side) and Pin (plain object).
{
  const v = V.map((p) => `v ${p.join(" ")}`).join("\n");
  const f = (t) => `f ${t.map((i) => i + 1).join(" ")}`;
  const text = [
    "# view-anything test fixture",
    v,
    "o Body",
    f(TRIS[0]),
    f(TRIS[1]),
    "g Lid",
    f(TRIS[2]),
    f(TRIS[3]),
    "g Side",
    f(TRIS[4]),
    "o Pin",
    f(TRIS[5]),
    f(TRIS[6]),
    "",
  ].join("\n");
  writeFileSync(join(out, "groups.obj"), text);
}

// ASCII PLY: the cube as 6 quads with per-vertex colors (loader triangulates to 12).
{
  const head = [
    "ply",
    "format ascii 1.0",
    `element vertex ${V.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    `element face ${QUADS.length}`,
    "property list uchar int vertex_indices",
    "end_header",
  ];
  const verts = V.map((p, i) => `${p.join(" ")} ${i * 30} ${255 - i * 30} 128`);
  const faces = QUADS.map((q) => `4 ${q.join(" ")}`);
  writeFileSync(join(out, "cube-color.ply"), [...head, ...verts, ...faces, ""].join("\n"));
}

// Binary little-endian PLY point cloud (no faces): 5 points.
{
  const pts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]];
  const head = Buffer.from(
    ["ply", "format binary_little_endian 1.0", `element vertex ${pts.length}`, "property float x", "property float y", "property float z", "end_header", ""].join("\n"),
    "ascii",
  );
  const body = Buffer.alloc(pts.length * 12);
  pts.forEach((p, k) => p.forEach((x, j) => body.writeFloatLE(x, k * 12 + j * 4)));
  writeFileSync(join(out, "points.ply"), Buffer.concat([head, body]));
}

// GLB: Assembly -> [Wheel (translated mesh), Body (mesh with 2 primitives), Arm (mesh) -> Hand (mesh)].
{
  const doc = new Document();
  const buffer = doc.createBuffer();
  const tri = (offset) => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0].map((x, i) => x + (i % 3 === 2 ? offset : 0)));
    const acc = doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buffer);
    return doc.createPrimitive().setAttribute("POSITION", acc);
  };
  const mesh = (name, ...prims) => {
    const m = doc.createMesh(name);
    prims.forEach((p) => m.addPrimitive(p));
    return m;
  };
  const wheel = doc.createNode("Wheel").setMesh(mesh("WheelMesh", tri(0))).setTranslation([2, 0, 0]);
  const body = doc.createNode("Body").setMesh(mesh("BodyMesh", tri(0), tri(1)));
  const hand = doc.createNode("Hand").setMesh(mesh("HandMesh", tri(0))).setTranslation([0, 1, 0]);
  const arm = doc.createNode("Arm").setMesh(mesh("ArmMesh", tri(0))).addChild(hand);
  const root = doc.createNode("Assembly").addChild(wheel).addChild(body).addChild(arm);
  doc.createScene("Scene").addChild(root);
  const glb = await new NodeIO().writeBinary(doc);
  writeFileSync(join(out, "assembly.glb"), glb);
}

console.log(`fixtures written to ${out}`);
