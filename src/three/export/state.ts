// State JSON embedded in an exported HTML file: what the runtime restores (camera, display frame
// and unit, display mode, sections, panel, scene tree). No three.js, no Tauri: the runtime parses
// it with `parseState`, which rejects anything that does not match the schema.
import { FRAME_PRESETS, UNITS, type FramePreset, type Unit } from "../core/frames";
import { DISPLAY_MODES, type DisplayMode } from "../core/display-modes";
import type { NodeKind } from "../core/scene-model";

export const STATE_VERSION = 1;

export interface ExportNode {
  id: string;
  name: string;
  kind: NodeKind;
  visible: boolean;
  children: ExportNode[];
}

export interface ExportFile {
  id: string;
  name: string;
  format: string;
  sourceUnit: Unit | "as-is";
  tree: ExportNode;
}

export interface ExportSection {
  enabled: boolean;
  /** Display coordinates; null: never set. */
  value: number | null;
}

export interface ExportState {
  version: typeof STATE_VERSION;
  title: string;
  display: FramePreset;
  unit: Unit;
  mode: DisplayMode;
  /** X, Y, Z. */
  sections: ExportSection[];
  /** World coordinates (the runtime uses the same display frame, so the same world). */
  camera: { position: [number, number, number]; target: [number, number, number]; quaternion?: [number, number, number, number] };
  navigation?: "arcball" | "fly";
  panelCollapsed?: boolean;
  files: ExportFile[];
}

const KINDS: readonly NodeKind[] = ["file", "assembly", "part", "mesh"];
/** Deepest tree accepted (guards the recursive parse). */
const MAX_DEPTH = 256;

function fail(field: string): never {
  throw new Error(`invalid export state: ${field}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string") fail(field);
  return v;
}

function oneOf<T extends string>(v: unknown, values: readonly T[], field: string): T {
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) fail(field);
  return v as T;
}

function vec3(v: unknown, field: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) fail(field);
  return [v[0], v[1], v[2]];
}

function node(v: unknown, depth: number): ExportNode {
  if (depth > MAX_DEPTH) fail("tree depth");
  if (!isObject(v)) fail("tree node");
  if (typeof v.visible !== "boolean") fail("tree visible");
  if (!Array.isArray(v.children)) fail("tree children");
  return {
    id: str(v.id, "tree id"),
    name: str(v.name, "tree name"),
    kind: oneOf(v.kind, KINDS, "tree kind"),
    visible: v.visible,
    children: v.children.map((c) => node(c, depth + 1)),
  };
}

export function parseState(input: unknown): ExportState {
  if (!isObject(input)) fail("not an object");
  if (input.version !== STATE_VERSION) fail(`version ${String(input.version)}`);
  const sections = input.sections;
  if (!Array.isArray(sections) || sections.length !== 3) fail("sections");
  const camera = input.camera;
  if (!isObject(camera)) fail("camera");
  if (!Array.isArray(input.files)) fail("files");
  if (input.panelCollapsed !== undefined && typeof input.panelCollapsed !== "boolean") fail("panelCollapsed");
  if (camera.quaternion !== undefined && (!Array.isArray(camera.quaternion) || camera.quaternion.length !== 4 || !camera.quaternion.every((n) => typeof n === "number" && Number.isFinite(n)))) fail("camera quaternion");
  const state: ExportState = {
    version: STATE_VERSION,
    title: str(input.title, "title"),
    display: oneOf(input.display, FRAME_PRESETS, "display"),
    unit: oneOf(input.unit, UNITS, "unit"),
    mode: oneOf(input.mode, DISPLAY_MODES, "mode"),
    sections: sections.map((s) => {
      if (!isObject(s) || typeof s.enabled !== "boolean") fail("sections");
      if (s.value !== null && !(typeof s.value === "number" && Number.isFinite(s.value))) fail("sections value");
      return { enabled: s.enabled, value: s.value as number | null };
    }),
    camera: { position: vec3(camera.position, "camera position"), target: vec3(camera.target, "camera target") },
    files: input.files.map((f) => {
      if (!isObject(f)) fail("file");
      return {
        id: str(f.id, "file id"),
        name: str(f.name, "file name"),
        format: str(f.format, "file format"),
        sourceUnit: oneOf(f.sourceUnit, ["as-is", ...UNITS] as const, "sourceUnit"),
        tree: node(f.tree, 0),
      };
    }),
  };
  if (input.panelCollapsed !== undefined) state.panelCollapsed = input.panelCollapsed as boolean;
  if (camera.quaternion !== undefined) state.camera.quaternion = camera.quaternion as [number, number, number, number];
  if (input.navigation !== undefined) state.navigation = oneOf(input.navigation, ["arcball", "fly"] as const, "navigation");
  return state;
}
