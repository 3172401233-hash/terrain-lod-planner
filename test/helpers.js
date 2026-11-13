import { Heightmap } from "../lib/heightmap.js";

// Deterministic synthetic terrain. `shape` selects the height function so
// tests can exercise flat (zero-error), smooth, and ridged surfaces.
export function makeHeightmap({
  columns = 17,
  rows = 17,
  cellSize = 10,
  shape = "wave",
  origin = { x: 0, z: 0 },
  heightScale = 1,
} = {}) {
  const heights = new Float64Array(columns * rows);
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < columns; ix++) {
      let h;
      const x = ix * cellSize;
      const z = iz * cellSize;
      switch (shape) {
        case "flat":
          h = 0;
          break;
        case "wave":
          h =
            Math.sin(x * 0.08) * 12 +
            Math.cos(z * 0.05) * 8 +
            Math.sin((x + z) * 0.03) * 4;
          break;
        case "ridge":
          h = Math.abs(Math.sin(x * 0.1)) * 30 + Math.cos(z * 0.07) * 5;
          break;
        case "sphere":
          h = Math.max(0, 40 - Math.hypot(x - 80, z - 80));
          break;
        default:
          h = 0;
      }
      heights[iz * columns + ix] = h;
    }
  }
  return new Heightmap({ columns, rows, cellSize, heights, origin, heightScale });
}

export function makeCamera(overrides = {}) {
  return {
    position: [80, 60, -40],
    forward: [0, -0.5, 1],
    up: [0, 1, 0],
    fovY: Math.PI / 3,
    aspect: 16 / 9,
    near: 1,
    far: 1000,
    ...overrides,
  };
}

export function baseOptions(overrides = {}) {
  return {
    maxDepth: 6,
    screenErrorThreshold: 8,
    maxVertexBudget: Infinity,
    hysteresis: 0.25,
    screenHeight: 720,
    ...overrides,
  };
}

// Structural invariants shared by every plan result.
export function assertValidPlan(assert, plan) {
  assert.ok(Array.isArray(plan.patches));
  assert.ok(Array.isArray(plan.skirts));
  const ids = plan.patches.map((p) => p.nodeId);
  assert.strictEqual(new Set(ids).size, ids.length, "patch ids are unique");

  let cursor = 0;
  for (const patch of plan.patches) {
    assert.strictEqual(patch.indexRange.start, cursor);
    cursor += patch.indexRange.count;
  }
  for (const skirt of plan.skirts) {
    assert.strictEqual(skirt.indexRange.start, cursor);
    cursor += skirt.indexRange.count;
  }
  assert.strictEqual(cursor, plan.stats.totalIndexCount);

  // Patches must tile the terrain: their cell rectangles never overlap.
  // Border samples are shared between neighbours, so compare cell spans
  // [ix0, ix1-1] rather than the raw half-open sample rectangles.
  for (let i = 0; i < plan.patches.length; i++) {
    for (let j = i + 1; j < plan.patches.length; j++) {
      const a = plan.patches[i].sampleRect;
      const b = plan.patches[j].sampleRect;
      const overlap =
        a.ix0 < b.ix1 - 1 && b.ix0 < a.ix1 - 1 &&
        a.iz0 < b.iz1 - 1 && b.iz0 < a.iz1 - 1;
      assert.strictEqual(overlap, false, "patch sample rects do not overlap");
    }
  }
}
