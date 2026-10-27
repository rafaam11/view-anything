/**
 * Scene panel model: files -> assembly tree -> meshes. Pure data, no three.js,
 * no Tauri; shared with the exported-HTML runtime.
 *
 * Node ids are stable path strings: the file node id is the file id (which
 * must not contain '/'), and each
 * child appends its index (`${fileId}/0/2/1`). Direct meshes of an assembly
 * become mesh leaves `${nodeId}/m${k}`. Rebuilding the same input yields the
 * same ids, so exported HTML can map visibility state back onto nodes.
 */
import type { FramePreset, Unit } from "./frames";

/**
 * Parser output (occt-import-js shaped). `meshes` are indices into the file's
 * flat mesh list; `meshNames[i]` (passed alongside) names mesh i.
 */
export interface ParsedTree {
  name?: string;
  meshes: number[];
  children: ParsedTree[];
}

export type NodeKind = "file" | "assembly" | "part" | "mesh";

export interface NodeStats {
  triangles: number;
  /** Bounding box size in display units. */
  size?: [number, number, number];
}

export interface TreeNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** The node's own flag; a node is effectively shown only if all ancestors are too. */
  visible: boolean;
  children: TreeNode[];
  /** Indices into the file's flat mesh list owned directly by this node. */
  meshIds: number[];
  stats?: NodeStats;
}

export interface SceneFile {
  id: string;
  path: string;
  name: string;
  format: string;
  sourceFrame: FramePreset | "as-is";
  sourceUnit: Unit | "as-is";
  root: TreeNode;
}

export interface SceneModel {
  files: SceneFile[];
}

/**
 * Build the file's tree. An unnamed root is merged into the file node; a
 * named root becomes the file node's single child. Empty names fall back to
 * the first mesh's name (leaf nodes only), then to `Part N` (N counts per
 * file, pre-order). Nodes with no meshes anywhere below them are pruned; ids
 * keep the source child index, so pruning never renumbers the rest.
 * `fileId` must not contain '/' (ids are '/'-joined paths).
 */
export function buildTree(parsed: ParsedTree, fileName: string, fileId: string, meshNames: string[] = []): TreeNode {
  if (fileId.includes("/")) throw new Error(`fileId must not contain '/': ${fileId}`);
  let partCounter = 0;
  const autoName = (meshes: number[]): string => {
    const fromMesh = meshes.length > 0 ? meshNames[meshes[0]]?.trim() : "";
    return fromMesh || `Part ${++partCounter}`;
  };

  // Kept children with their source index (ids use it, so they stay stable when siblings are pruned).
  const live = (node: ParsedTree): [ParsedTree, number][] =>
    node.children.map((child, i): [ParsedTree, number] => [child, i]).filter(([child]) => !isEmpty(child));

  const buildChildren = (node: ParsedTree, id: string): { children: TreeNode[]; meshIds: number[] } => {
    const kept = live(node);
    const children = kept.map(([child, i]) => build(child, `${id}/${i}`));
    if (kept.length === 0) return { children, meshIds: [...node.meshes] };
    // Assembly with its own meshes: expose each as a toggleable mesh leaf.
    node.meshes.forEach((meshId, k) => {
      children.push({
        id: `${id}/m${k}`,
        name: autoName([meshId]),
        kind: "mesh",
        visible: true,
        children: [],
        meshIds: [meshId],
      });
    });
    return { children, meshIds: [] };
  };

  const build = (node: ParsedTree, id: string): TreeNode => {
    // Assemblies never borrow a mesh name: their direct meshes already show it as /m leaves.
    const assembly = live(node).length > 0;
    const name = node.name?.trim() || autoName(assembly ? [] : node.meshes);
    const { children, meshIds } = buildChildren(node, id);
    return { id, name, kind: assembly ? "assembly" : "part", visible: true, children, meshIds };
  };

  const merged = !parsed.name?.trim();
  const { children, meshIds } = merged
    ? buildChildren(parsed, fileId)
    : { children: isEmpty(parsed) ? [] : [build(parsed, `${fileId}/0`)], meshIds: [] };
  return { id: fileId, name: fileName, kind: "file", visible: true, children, meshIds };
}

/** A node with no meshes anywhere below it: pruned from the panel tree (no empty "Part N" rows). */
function isEmpty(node: ParsedTree): boolean {
  return node.meshes.length === 0 && node.children.every(isEmpty);
}

function findIn(node: TreeNode, id: string): TreeNode | undefined {
  if (node.id === id) return node;
  if (!id.startsWith(node.id + "/")) return undefined;
  for (const child of node.children) {
    const hit = findIn(child, id);
    if (hit) return hit;
  }
  return undefined;
}

export function findNode(model: SceneModel, nodeId: string): TreeNode | undefined {
  for (const file of model.files) {
    const hit = findIn(file.root, nodeId);
    if (hit) return hit;
  }
  return undefined;
}

/** Set a node's own visibility flag. Returns false if the node does not exist. */
export function setVisible(model: SceneModel, nodeId: string, visible: boolean): boolean {
  const node = findNode(model, nodeId);
  if (!node) return false;
  node.visible = visible;
  return true;
}

/** Remove a file from the model. Returns false if it was not present. */
export function removeFile(model: SceneModel, fileId: string): boolean {
  const index = model.files.findIndex((f) => f.id === fileId);
  if (index < 0) return false;
  model.files.splice(index, 1);
  return true;
}

/** Mesh indices under `node` that are effectively visible (node and all ancestors shown), sorted. */
export function visibleMeshIds(node: TreeNode): number[] {
  const out: number[] = [];
  const walk = (n: TreeNode) => {
    if (!n.visible) return;
    out.push(...n.meshIds);
    n.children.forEach(walk);
  };
  walk(node);
  return out.sort((a, b) => a - b);
}
