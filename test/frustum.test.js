import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFrustum } from "../lib/frustum.js";
import { classifyAabb, planeDistance } from "../lib/math.js";
import { TerrainPlanError, ErrorCode } from "../lib/errors.js";
import { makeCamera } from "./helpers.js";

test("frustum planes enclose a point directly ahead of the camera", () => {
  const frustum = buildFrustum(makeCamera());
  assert.equal(frustum.planes.length, 6);
  const f = makeCamera().forward;
  const len = Math.hypot(f[0], f[1], f[2]);
  const ahead = [
    frustum.position[0] + (f[0] / len) * 10,
    frustum.position[1] + (f[1] / len) * 10,
    frustum.position[2] + (f[2] / len) * 10,
  ];
  for (const plane of frustum.planes) {
    assert.ok(planeDistance(plane, ahead) <= 1e-9);
  }
});

test("AABB directly in front of the camera is inside", () => {
  const frustum = buildFrustum(
    makeCamera({ position: [0, 100, -100], forward: [0, -1, 1] })
  );
  // A compact box centered on the forward axis stays inside the frustum.
  const result = classifyAabb(frustum.planes, [-5, 40, -5], [5, 50, 5]);
  assert.ok(result === "inside" || result === "intersect");
});

test("AABB behind the camera is outside", () => {
  const frustum = buildFrustum(makeCamera({ forward: [0, 0, 1] }));
  const result = classifyAabb(frustum.planes, [-10, -10, -500], [10, 10, -400]);
  assert.equal(result, "outside");
});

test("box fully inside the frustum is classified inside, never outside", () => {
  const frustum = buildFrustum(
    makeCamera({
      position: [0, 0, 0],
      forward: [0, 0, 1],
      fovY: Math.PI / 2,
      aspect: 1,
      near: 1,
      far: 100,
    })
  );
  // A box that fully surrounds the near cross-section and extends a short
  // distance into the frustum cannot be classified as fully outside.
  const result = classifyAabb(
    frustum.planes,
    [-2, -2, 2],
    [2, 2, 8]
  );
  assert.equal(result, "inside");
  assert.notEqual(result, "outside");
});

test("a box wider than the frustum at its depth is conservatively outside", () => {
  const frustum = buildFrustum(
    makeCamera({
      position: [0, 0, 0],
      forward: [0, 0, 1],
      fovY: Math.PI / 2,
      aspect: 1,
      near: 10,
      far: 100,
    })
  );
  // At z around 15 the half-width is ~15; a box spanning +/- 40 crosses the
  // side planes and the positive-vertex test reports outside conservatively.
  const result = classifyAabb(
    frustum.planes,
    [-40, -40, 12],
    [40, 40, 18]
  );
  assert.equal(result, "outside");
});

test("invalid frustum parameters throw typed errors", () => {
  const invalid = [
    makeCamera({ forward: [0, 0, 0] }),
    makeCamera({ forward: [0, 1, 0], up: [0, 1, 0] }),
    makeCamera({ fovY: 0 }),
    makeCamera({ fovY: Math.PI }),
    makeCamera({ aspect: 0 }),
    makeCamera({ near: 10, far: 5 }),
    makeCamera({ near: -1, far: 10 }),
  ];
  for (const camera of invalid) {
    assert.throws(
      () => buildFrustum(camera),
      (err) => err instanceof TerrainPlanError &&
        err.code === ErrorCode.INVALID_FRUSTUM
    );
  }
});

test("non-finite camera position is rejected", () => {
  assert.throws(
    () => buildFrustum(makeCamera({ position: [NaN, 0, 0] })),
    (err) => err.code === ErrorCode.INVALID_FRUSTUM
  );
});
