import { test } from "node:test";
import assert from "node:assert/strict";
import { TerrainQuadtree, dataMaxDepth } from "../lib/quadtree.js";
import { makeHeightmap } from "./helpers.js";

test("root spans the full heightmap and stores bounds plus error", () => {
  const map = makeHeightmap({ columns: 17, rows: 17 });
  const tree = new TerrainQuadtree(map, 4);
  assert.equal(tree.root.ix0, 0);
  assert.equal(tree.root.iz0, 0);
  assert.equal(tree.root.ix1, 17);
  assert.equal(tree.root.iz1, 17);
  assert.ok(tree.root.bounds.min.length === 3);
  assert.ok(tree.root.geometricError >= 0);
});

test("split produces four canonical quadrants sharing the midpoint sample", () => {
  const map = makeHeightmap({ columns: 33, rows: 33 });
  const tree = new TerrainQuadtree(map, 5);
  const children = tree.split(tree.root);
  assert.equal(children.length, 4);
  assert.deepEqual(children.map((c) => c.id), [
    "root/LN",
    "root/RN",
    "root/LF",
    "root/RF",
  ]);
  // Both halves include the midpoint sample (index 16) on their border.
  const [ln, rn, lf, rf] = children;
  assert.equal(ln.ix0, 0);
  assert.equal(ln.ix1, 17);
  assert.equal(rn.ix0, 16);
  assert.equal(rn.ix1, 33);
  assert.equal(lf.iz0, 16);
  assert.equal(lf.iz1, 33);
  assert.equal(rf.iz0, 16);
  assert.equal(rf.iz1, 33);
  assert.equal(lf.ix0, 0);
  assert.equal(lf.ix1, 17);
  assert.equal(rf.ix0, 16);
  assert.equal(rf.ix1, 33);
  assert.ok(children.every((c) => c.depth === 1 && c.parent === tree.root));
});

test("repeated split is idempotent and walks in canonical quadrant order", () => {
  const map = makeHeightmap({ columns: 17, rows: 17 });
  const tree = new TerrainQuadtree(map, 4);
  const first = tree.split(tree.root);
  const second = tree.split(tree.root);
  assert.strictEqual(first, second);
  const walked = [...tree.walk()].map((n) => n.id);
  assert.deepEqual(walked, [
    "root",
    "root/LN",
    "root/RN",
    "root/LF",
    "root/RF",
  ]);
});

test("splitting at maxDepth or data resolution returns null and flags the limit", () => {
  const map = makeHeightmap({ columns: 17, rows: 17 });
  const tree = new TerrainQuadtree(map, 1);
  const children = tree.split(tree.root);
  assert.equal(children.length, 4);
  const blocked = tree.split(children[0]);
  assert.equal(blocked, null);
  assert.equal(tree.depthLimitReached, true);
});

test("dataMaxDepth reflects the longer dimension for non-square grids", () => {
  const square = makeHeightmap({ columns: 17, rows: 17 });
  const wide = makeHeightmap({ columns: 33, rows: 17 });
  assert.equal(dataMaxDepth(square), 4);
  assert.equal(dataMaxDepth(wide), 5);
});

test("non-square quadtree keeps every child inside the sample bounds", () => {
  const map = makeHeightmap({ columns: 33, rows: 17 });
  const tree = new TerrainQuadtree(map, 5);
  tree.split(tree.root);
  for (const child of tree.root.children) {
    assert.ok(child.ix0 >= 0 && child.ix1 <= 33);
    assert.ok(child.iz0 >= 0 && child.iz1 <= 17);
    assert.ok(child.sampleColumns >= 1 && child.sampleRows >= 1);
  }
});
