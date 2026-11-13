import {
  buildFrustumPlanes,
  lookAt,
  multiplyMat4,
  normalize,
  perspective,
  length,
} from "./math.js";
import { TerrainPlanError, ErrorCode } from "./errors.js";

// Builds the six outward-facing frustum planes for a perspective camera.
// Throws TerrainPlanError(INVALID_FRUSTUM) for any parameter combination
// that would produce a degenerate frustum (zero-length axes, bad ranges).
export function buildFrustum(camera) {
  const {
    position,
    forward,
    fovY,
    aspect,
    near,
    far,
    up = [0, 1, 0],
  } = camera;

  if (!Array.isArray(position) || position.length !== 3 ||
      position.some((v) => !Number.isFinite(v))) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_FRUSTUM,
      "camera.position must be a finite 3-component vector",
      { position }
    );
  }
  if (!Array.isArray(forward) || forward.length !== 3 ||
      forward.some((v) => !Number.isFinite(v))) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_FRUSTUM,
      "camera.forward must be a finite 3-component vector",
      { forward }
    );
  }
  let fwd = normalize(forward);
  if (length(fwd) === 0) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_FRUSTUM,
      "camera.forward must not be a zero-length vector"
    );
  }
  const upInput = normalize(up);
  if (length(upInput) === 0) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_FRUSTUM,
      "camera.up must not be a zero-length vector"
    );
  }
  // Parallel forward/up leaves the roll undefined.
  if (Math.abs(fwd[0] * upInput[0] + fwd[1] * upInput[1] +
      fwd[2] * upInput[2]) > 1 - 1e-9) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_FRUSTUM,
      "camera.forward and camera.up must not be parallel"
    );
  }
  if (!(fovY > 0) || fovY >= Math.PI || !Number.isFinite(fovY)) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_FRUSTUM,
      "camera.fovY must be in the open interval (0, pi)",
      { fovY }
    );
  }
  if (!(aspect > 0) || !Number.isFinite(aspect)) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_FRUSTUM,
      "camera.aspect must be a positive finite number",
      { aspect }
    );
  }
  if (!(near > 0) || !(far > near) ||
      !Number.isFinite(near) || !Number.isFinite(far)) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_FRUSTUM,
      "camera requires 0 < near < far with finite values",
      { near, far }
    );
  }

  // Gram-Schmidt: project the requested up onto the plane orthogonal to
  // forward so the camera basis is fully orthonormal.
  const fDotUp = fwd[0] * upInput[0] + fwd[1] * upInput[1] +
    fwd[2] * upInput[2];
  const upNorm = normalize([
    upInput[0] - fDotUp * fwd[0],
    upInput[1] - fDotUp * fwd[1],
    upInput[2] - fDotUp * fwd[2],
  ]);
  const view = lookAt(position, fwd, upNorm);
  const proj = perspective(fovY, aspect, near, far);
  const viewProj = multiplyMat4(proj, view);
  const planes = buildFrustumPlanes({
    position,
    forward: fwd,
    up: upNorm,
    fovY,
    aspect,
    near,
    far,
  });
  return { planes, viewProj, position, fovY, near, far };
}
