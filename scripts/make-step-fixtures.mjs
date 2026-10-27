// Usage: node scripts/make-step-fixtures.mjs
// Writes the hand-built AP214 STEP fixtures in tests/fixtures/3d/ (deterministic, committed):
//   cube.step      one part "Cube", 10 x 20 x 30 mm box, body blue, +Z face red
//   assembly.step  assembly "Assembly" with parts "PartA" (10 mm cube at origin) and
//                  "PartB" (5 x 5 x 40 mm box placed at x = 100 mm)
//   cube-inch.step one part "InchCube", 1 x 2 x 3 inch box (file unit INCH)
// Boxes are planar B-reps (vertices, line edges, plane faces) without pcurves; OCCT rebuilds
// those itself.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(fileURLToPath(import.meta.url), "..", "..", "tests", "fixtures", "3d");
mkdirSync(out, { recursive: true });

class Step {
  constructor() {
    this.lines = [];
    this.n = 0;
  }
  add(text) {
    this.n += 1;
    this.lines.push(`#${this.n} = ${text};`);
    return `#${this.n}`;
  }
  num(x) {
    const s = Number(x).toString();
    return s.includes(".") || s.includes("e") ? s.toUpperCase() : `${s}.`;
  }
  point(p) {
    return this.add(`CARTESIAN_POINT('',(${p.map((x) => this.num(x)).join(",")}))`);
  }
  dir(d) {
    return this.add(`DIRECTION('',(${d.map((x) => this.num(x)).join(",")}))`);
  }
  axis(origin = [0, 0, 0], z = [0, 0, 1], x = [1, 0, 0]) {
    return this.add(`AXIS2_PLACEMENT_3D('',${this.point(origin)},${this.dir(z)},${this.dir(x)})`);
  }
  text(schema = "AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }") {
    return [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION(('view-anything test fixture'),'2;1');",
      "FILE_NAME('fixture','2026-10-27T00:00:00',(''),(''),'make-step-fixtures','view-anything','');",
      `FILE_SCHEMA(('${schema}'));`,
      "ENDSEC;",
      "DATA;",
      ...this.lines,
      "ENDSEC;",
      "END-ISO-10303-21;",
      "",
    ].join("\n");
  }
}

/** Geometric context with the given length unit ("mm" or "inch"). */
function context(s, unit) {
  let length;
  if (unit === "inch") {
    const mm = s.add("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )");
    const measure = s.add(`LENGTH_MEASURE_WITH_UNIT(25.4,${mm})`);
    const dims = s.add("DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)");
    length = s.add(`( CONVERSION_BASED_UNIT('INCH',${measure}) LENGTH_UNIT() NAMED_UNIT(${dims}) )`);
  } else {
    length = s.add("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )");
  }
  const angle = s.add("( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )");
  const solid = s.add("( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )");
  const unc = s.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${length},'distance_accuracy_value','confusion accuracy')`);
  return s.add(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) ` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((${length},${angle},${solid})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`,
  );
}

/** Box [min, max] as a MANIFOLD_SOLID_BREP. Returns the solid and its faces keyed "-x".."+z". */
function box(s, min, max) {
  const corner = (i, j, k) => [i ? max[0] : min[0], j ? max[1] : min[1], k ? max[2] : min[2]];
  const vertices = new Map();
  const vertex = (key) => {
    if (!vertices.has(key)) {
      const p = corner(...key.split("").map(Number));
      vertices.set(key, { p, ref: s.add(`VERTEX_POINT('',${s.point(p)})`) });
    }
    return vertices.get(key);
  };
  const edges = new Map();
  const edge = (a, b) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!edges.has(key)) {
      const [from, to] = a < b ? [a, b] : [b, a];
      const p = vertex(from).p;
      const q = vertex(to).p;
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const len = Math.hypot(...d);
      const line = s.add(`LINE('',${s.point(p)},${s.add(`VECTOR('',${s.dir(d.map((x) => x / len))},${s.num(len)})`)})`);
      edges.set(key, { from, ref: s.add(`EDGE_CURVE('',${vertex(from).ref},${vertex(to).ref},${line},.T.)`) });
    }
    const e = edges.get(key);
    return s.add(`ORIENTED_EDGE('',*,*,${e.ref},${e.from === a ? ".T." : ".F."})`);
  };
  // Corners "ijk" counter-clockwise seen from outside, with the outward normal.
  const FACES = {
    "-z": [["000", "010", "110", "100"], [0, 0, -1]],
    "+z": [["001", "101", "111", "011"], [0, 0, 1]],
    "-y": [["000", "100", "101", "001"], [0, -1, 0]],
    "+y": [["010", "011", "111", "110"], [0, 1, 0]],
    "-x": [["000", "001", "011", "010"], [-1, 0, 0]],
    "+x": [["100", "110", "111", "101"], [1, 0, 0]],
  };
  const faces = {};
  for (const [name, [loop, normal]] of Object.entries(FACES)) {
    const oriented = loop.map((a, i) => edge(a, loop[(i + 1) % 4]));
    const edgeLoop = s.add(`EDGE_LOOP('',(${oriented.join(",")}))`);
    const bound = s.add(`FACE_OUTER_BOUND('',${edgeLoop},.T.)`);
    const p0 = vertex(loop[0]).p;
    const p1 = vertex(loop[1]).p;
    const x = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const xl = Math.hypot(...x);
    const plane = s.add(`PLANE('',${s.axis(p0, normal, x.map((v) => v / xl))})`);
    faces[name] = s.add(`ADVANCED_FACE('',(${bound}),${plane},.T.)`);
  }
  const shell = s.add(`CLOSED_SHELL('',(${Object.values(faces).join(",")}))`);
  return { solid: s.add(`MANIFOLD_SOLID_BREP('',${shell})`), faces };
}

function appContext(s) {
  const app = s.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  s.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  return app;
}

/** PRODUCT ... PRODUCT_DEFINITION chain; returns the product definition. */
function product(s, app, name) {
  const pc = s.add(`PRODUCT_CONTEXT('',${app},'mechanical')`);
  const p = s.add(`PRODUCT('${name}','${name}','',(${pc}))`);
  s.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${p}))`);
  const pdf = s.add(`PRODUCT_DEFINITION_FORMATION('','',${p})`);
  const pdc = s.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`);
  return s.add(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`);
}

/** A part (product + ABSR with one box). Returns its definition, representation and origin axis. */
function part(s, app, ctx, name, min, max) {
  const pd = product(s, app, name);
  const pds = s.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const origin = s.axis();
  const b = box(s, min, max);
  const rep = s.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${origin},${b.solid}),${ctx})`);
  s.add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
  return { pd, rep, origin, box: b };
}

function colour(s, target, rgb) {
  const col = s.add(`COLOUR_RGB('',${rgb.map((x) => s.num(x)).join(",")})`);
  const fasc = s.add(`FILL_AREA_STYLE_COLOUR('',${col})`);
  const fas = s.add(`FILL_AREA_STYLE('',(${fasc}))`);
  const ssfa = s.add(`SURFACE_STYLE_FILL_AREA(${fas})`);
  const ssss = s.add(`SURFACE_SIDE_STYLE('',(${ssfa}))`);
  const ssu = s.add(`SURFACE_STYLE_USAGE(.BOTH.,${ssss})`);
  const psa = s.add(`PRESENTATION_STYLE_ASSIGNMENT((${ssu}))`);
  return s.add(`STYLED_ITEM('color',(${psa}),${target})`);
}

function singlePart(name, unit, min, max, colours) {
  const s = new Step();
  const app = appContext(s);
  const ctx = context(s, unit);
  const p = part(s, app, ctx, name, min, max);
  if (colours) {
    const styled = [colour(s, p.box.solid, colours.body), colour(s, p.box.faces["+z"], colours.top)];
    s.add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styled.join(",")}),${ctx})`);
  }
  return s.text();
}

function assembly() {
  const s = new Step();
  const app = appContext(s);
  const ctx = context(s, "mm");
  const asmPd = product(s, app, "Assembly");
  const asmPds = s.add(`PRODUCT_DEFINITION_SHAPE('','',${asmPd})`);
  const children = [
    { name: "PartA", min: [0, 0, 0], max: [10, 10, 10], at: [0, 0, 0] },
    { name: "PartB", min: [0, 0, 0], max: [5, 5, 40], at: [100, 0, 0] },
  ];
  const placements = children.map((c) => s.axis(c.at));
  const asmOrigin = s.axis();
  const asmRep = s.add(`SHAPE_REPRESENTATION('',(${asmOrigin},${placements.join(",")}),${ctx})`);
  s.add(`SHAPE_DEFINITION_REPRESENTATION(${asmPds},${asmRep})`);
  children.forEach((c, i) => {
    const p = part(s, app, ctx, c.name, c.min, c.max);
    const nauo = s.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${i + 1}','${c.name}','',${asmPd},${p.pd},$)`);
    const nauoPds = s.add(`PRODUCT_DEFINITION_SHAPE('Placement','Placement of an item',${nauo})`);
    const idt = s.add(`ITEM_DEFINED_TRANSFORMATION('','',${p.origin},${placements[i]})`);
    const rr = s.add(
      `( REPRESENTATION_RELATIONSHIP('','',${p.rep},${asmRep}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${idt}) SHAPE_REPRESENTATION_RELATIONSHIP() )`,
    );
    s.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${rr},${nauoPds})`);
  });
  return s.text();
}

writeFileSync(join(out, "cube.step"), singlePart("Cube", "mm", [0, 0, 0], [10, 20, 30], { body: [0.2, 0.4, 0.8], top: [1, 0, 0] }));
writeFileSync(join(out, "assembly.step"), assembly());
writeFileSync(join(out, "cube-inch.step"), singlePart("InchCube", "inch", [0, 0, 0], [1, 2, 3]));
console.log(`wrote cube.step, assembly.step, cube-inch.step to ${out}`);
