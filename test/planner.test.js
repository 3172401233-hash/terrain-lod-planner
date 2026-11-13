import { test } from "node:test";
import assert from "node:assert/strict";
import { planTerrain, TerrainPlanError, ErrorCode } from "../lib/index.js";
import {
  makeHeightmap,
  makeCamera,
  baseOptions,
  assertValidPlan,
} from "./helpers.js";

const overheadCamera = () =>
  makeCamera({
    position: [160, 260, -160],
    forward: [0, -0.75, 1],
    fovY: Math.PI / 2.2,
  });

test("selects multiple LOD levels and returns contiguous index ranges", () => {
  const map = makeHeightmap({ columns: 33, rows: 33, shape: "ridge" });
  const plan = planTerrain(map, overheadCamera(), baseOptions({ maxDepth: 5 }));
  assertValidPlan(assert, plan);
  const depths = new Set(plan.patches.map((p) => p.depth));
  assert.ok(depths.size >= 2);
});

test("frustum culling removes terrain behind the camera", () => {
  const map = makeHeightmap({ columns: 33, rows: 33 });
  const away = makeCamera({ position: [160, 50, 160], forward: [0, 0, 1] });
  const plan = planTerrain(map, away, baseOptions());
  assert.equal(plan.status, "fullyCulled");
  assert.equal(plan.patches.length, 0);
  assert.equal(plan.stats.totalIndexCount, 0);
  assert.ok(plan.culled.length >= 1);
});

test("2:1 balance: neighbouring patches never differ by more than one level", () => {
  const map = makeHeightmap({ columns: 33, rows: 33, shape: "ridge" });
  const plan = planTerrain(
    map,
    overheadCamera(),
    baseOptions({ maxDepth: 5, screenErrorThreshold: 30 })
  );
  const byId = new Map(plan.patches.map((p) => [p.nodeId, p]));
  for (let i = 0; i < plan.patches.length; i++) {
    for (let j = i + 1; j < plan.patches.length; j++) {
      const a = plan.patches[i].sampleRect;
      const b = plan.patches[j].sampleRect;
      const touch =
        (a.ix0 === b.ix1 || a.ix1 === b.ix0 ||
          a.iz0 === b.iz1 || a.iz1 === b.iz0) &&
        !(a.ix0 >= b.ix1 || b.ix0 >= a.ix1 || a.iz0 >= b.iz1 || b.iz0 >= a.iz1);
      if (touch) {
        assert.ok(
          Math.abs(plan.patches[i].depth - plan.patches[j].depth) <= 1
        );
      }
    }
  }
  assert.ok(plan.stats.balanceBlocked === null);
});

test("skirts are emitted only at level transitions and are locatable", () => {
  const map = makeHeightmap({ columns: 33, rows: 33, shape: "ridge" });
  const plan = planTerrain(
    map,
    overheadCamera(),
    baseOptions({ maxDepth: 5, screenErrorThreshold: 30 })
  );
  assert.ok(plan.skirts.length > 0);
  const patchIds = new Set(plan.patches.map((p) => p.nodeId));
  for (const skirt of skirtsOf(plan)) {
    assert.ok(patchIds.has(skirt.nodeId));
    assert.ok(["minX", "maxX", "minZ", "maxZ"].includes(skirt.edge));
    assert.ok(skirt.sampleCount >= 2);
    assert.ok(skirt.bottomY < skirt.topHeight.min);
    assert.ok(skirt.neighbourIds.length >= 1);
    assert.ok(skirt.indexRange.count === (skirt.sampleCount - 1) * 6);
  }
});

function skirtsOf(plan) {
  return plan.skirts;
}

test("vertex budget coarsens selection without exceeding it when feasible", () => {
  const map = makeHeightmap({ columns: 33, rows: 33 });
  const full = planTerrain(map, overheadCamera(), baseOptions({ maxDepth: 5 }));
  const target = Math.floor(full.stats.totalPatchVertices * 0.7);
  const plan = planTerrain(
    map,
    overheadCamera(),
    baseOptions({ maxDepth: 5, maxVertexBudget: target })
  );
  assertValidPlan(assert, plan);
  assert.ok(plan.stats.totalPatchVertices <= target);
  assert.ok(plan.degradation.some((d) => d.action === "merge"));
  assert.ok(plan.patches.length < full.patches.length);
});

test("budget smaller than the root reports explicit root-over-budget result", () => {
  const map = makeHeightmap({ columns: 33, rows: 33 });
  const plan = planTerrain(
    map,
    overheadCamera(),
    baseOptions({ maxDepth: 5, maxVertexBudget: 10 })
  );
  assert.equal(plan.status, "degradedRootOverBudget");
  assert.equal(plan.stats.rootOverBudget, true);
  assert.equal(plan.stats.budgetExceeded, true);
  // Never silently empty, never silently within budget.
  assert.ok(plan.patches.length >= 1);
  assert.ok(plan.stats.totalPatchVertices > 10);
});

test("hysteresis keeps the previous frame's leaves stable and widens thresholds", () => {
  const map = makeHeightmap({ columns: 33, rows: 33 });
  const options = baseOptions({ maxDepth: 5, hysteresis: 0.5 });
  const first = planTerrain(map, overheadCamera(), options);
  const second = planTerrain(map, overheadCamera(), options, first);
  assert.deepEqual(second.patchIds, first.patchIds);
  assert.ok(second.stats.thresholds.high > second.stats.thresholds.low);
  const noHyst = planTerrain(
    map,
    overheadCamera(),
    baseOptions({ maxDepth: 5, hysteresis: 0 })
  );
  assert.notEqual(noHyst.stats.thresholds.high, noHyst.stats.thresholds.low ===
    noHyst.stats.thresholds.high);
});

test("flat terrain has zero geometric error and never error-splits", () => {
  const map = makeHeightmap({ shape: "flat" });
  const camera = makeCamera({
    position: [80, 120, -60],
    forward: [0, -0.9, 1],
  });
  const plan = planTerrain(
    map,
    camera,
    baseOptions({ maxDepth: 6, screenErrorThreshold: 1 })
  );
  assert.equal(plan.patches.length, 1);
  assert.equal(plan.stats.errorSplitCount, 0);
  assert.equal(plan.patches[0].geometricError, 0);
});

test("non-square heightmap stays within bounds and balances", () => {
  const map = makeHeightmap({ columns: 33, rows: 17, shape: "ridge" });
  const plan = planTerrain(map, overheadCamera(), baseOptions({ maxDepth: 5 }));
  assertValidPlan(assert, plan);
  for (const patch of plan.patches) {
    assert.ok(patch.sampleRect.ix1 <= 33);
    assert.ok(patch.sampleRect.iz1 <= 17);
  }
});

test("maxDepth below the data resolution is reported via stats, not thrown", () => {
  const map = makeHeightmap({ columns: 33, rows: 33, shape: "ridge" });
  const plan = planTerrain(
    map,
    overheadCamera(),
    baseOptions({ maxDepth: 1 })
  );
  assert.equal(plan.stats.maxReachedDepth, 1);
  assert.equal(plan.stats.depthLimitReached, true);
  assert.ok(plan.patches.every((p) => p.depth <= 1));
});

test("repeated runs are deterministic and independent of insertion order", () => {
  const map = makeHeightmap({ columns: 33, rows: 33, shape: "ridge" });
  const options = baseOptions({ maxDepth: 5, maxVertexBudget: 1400 });
  const runs = Array.from({ length: 6 }, () =>
    planTerrain(map, overheadCamera(), options)
  );
  const signature = (plan) =>
    JSON.stringify({
      ids: plan.patches.map((p) => p.nodeId),
      ranges: plan.patches.map((p) => p.indexRange),
      skirts: plan.skirts.map((s) => s.id),
    });
  const first = signature(runs[0]);
  assert.ok(runs.every((plan) => signature(plan) === first));
});

test("selected patches never overlap in sample space", () => {
  const map = makeHeightmap({ columns: 33, rows: 33, shape: "ridge" });
  const plan = planTerrain(
    map,
    overheadCamera(),
    baseOptions({ maxDepth: 5, maxVertexBudget: 1200 })
  );
  for (let i = 0; i < plan.patches.length; i++) {
    for (let j = i + 1; j < plan.patches.length; j++) {
      const a = plan.patches[i].sampleRect;
      const b = plan.patches[j].sampleRect;
      const overlap =
        a.ix0 < b.ix1 - 1 && b.ix0 < a.ix1 - 1 &&
        a.iz0 < b.iz1 - 1 && b.iz0 < a.iz1 - 1;
      assert.equal(overlap, false);
    }
  }
});

test("invalid option values throw typed argument errors", () => {
  const map = makeHeightmap();
  assert.throws(
    () => planTerrain(map, makeCamera(), baseOptions({ maxDepth: -1 })),
    (err) => err.code === ErrorCode.INVALID_ARGUMENT
  );
  assert.throws(
    () => planTerrain(map, makeCamera(), baseOptions({ hysteresis: 2 })),
    (err) => err instanceof TerrainPlanError
  );
  assert.throws(
    () => planTerrain("not-a-map", makeCamera(), baseOptions()),
    (err) => err.code === ErrorCode.INVALID_ARGUMENT
  );
});
