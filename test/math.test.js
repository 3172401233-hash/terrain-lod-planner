import { test } from "node:test";
import assert from "node:assert/strict";
import {
  add,
  cross,
  dot,
  normalize,
  screenSpaceError,
  distanceToAabb,
  perspective,
  lookAt,
  multiplyMat4,
} from "../lib/math.js";

test("vector basics", () => {
  assert.deepEqual(add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
  assert.equal(dot([1, 0, 0], [0, 1, 0]), 0);
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0]);
  const n = normalize([0, 0, 2]);
  assert.ok(Math.abs(n[2] - 1) < 1e-12);
});

test("screen-space error grows with geometric error and shrinks with distance", () => {
  const near = screenSpaceError(10, 50, Math.PI / 3, 720);
  const far = screenSpaceError(10, 200, Math.PI / 3, 720);
  assert.ok(near > far);
  assert.ok(far > 0);
  assert.equal(screenSpaceError(0, 100, Math.PI / 3, 720), 0);
});

test("distanceToAabb is zero inside the box and positive outside", () => {
  const min = [0, 0, 0];
  const max = [10, 10, 10];
  assert.equal(distanceToAabb([5, 5, 5], min, max), 0);
  assert.equal(distanceToAabb([13, 5, 5], min, max), 3);
  assert.ok(distanceToAabb([0, -4, 0], min, max) === 4);
});

test("perspective * lookAt maps a point in front into normalized clip range", () => {
  const proj = perspective(Math.PI / 3, 16 / 9, 1, 100);
  const view = lookAt([0, 0, -10], [0, 0, 1], [0, 1, 0]);
  const vp = multiplyMat4(proj, view);
  const point = [0, 0, 0, 1];
  const clip = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    clip[row] =
      vp[row * 4] * point[0] +
      vp[row * 4 + 1] * point[1] +
      vp[row * 4 + 2] * point[2] +
      vp[row * 4 + 3] * point[3];
  }
  const ndcZ = clip[2] / clip[3];
  assert.ok(ndcZ >= -1 && ndcZ <= 1);
});
