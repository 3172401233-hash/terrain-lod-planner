// Pure 3D / projection math helpers. No third-party dependencies.
// Coordinate convention: x = east, y = up, z = south. All vectors are
// plain [x, y, z] arrays so the library stays serialization friendly.

export function vec3(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const len = length(a);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Row-major 4x4 perspective projection matrix matching the classic
// OpenGL gluPerspective layout. fovY is in radians, aspect = width / height.
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
}

// Right-handed view matrix: camera at `eye`, looking along `forward`,
// with `up` resolving the roll. Forward must be normalized (or unit length).
export function lookAt(eye, forward, up) {
  const f = normalize(forward);
  // Right-handed camera basis: right = up x forward (so forward +z maps
  // right to +x when up is +y).
  const r = normalize(cross(up, f));
  const u = cross(r, f);
  // View space looks down -z, so the third row is -f.
  return [
    r[0], r[1], r[2], -dot(r, eye),
    u[0], u[1], u[2], -dot(u, eye),
    -f[0], -f[1], -f[2], dot(f, eye),
    0, 0, 0, 1,
  ];
}

export function multiplyMat4(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row * 4 + k] * b[k * 4 + col];
      }
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

// Build six outward-facing planes from explicit frustum corner geometry.
// Each plane is {normal, d} with the interior satisfying
// dot(normal, p) + d <= 0. Constructing corners directly avoids the
// sign conventions of matrix-based plane extraction.
export function buildFrustumPlanes({
  position,
  forward,
  up,
  fovY,
  aspect,
  near,
  far,
}) {
  const f = normalize(forward);
  const right = normalize(cross(up, f));
  const trueUp = normalize(cross(right, f));
  const tanHalf = Math.tan(fovY / 2);
  const tanHalfX = tanHalf * aspect;

  const corner = (distance, sx, sy) => {
    const hh = tanHalf * distance;
    const hw = tanHalfX * distance;
    return add(
      add(add(position, scale(f, distance)), scale(right, sx * hw)),
      scale(trueUp, sy * hh)
    );
  };

  const nBL = corner(near, -1, -1);
  const nBR = corner(near, 1, -1);
  const nTR = corner(near, 1, 1);
  const nTL = corner(near, -1, 1);
  const fBL = corner(far, -1, -1);
  const fBR = corner(far, 1, -1);
  const fTR = corner(far, 1, 1);
  const fTL = corner(far, -1, 1);

  const frustumCenter = scale(
    add(add(add(nBL, nBR), add(nTR, nTL)),
      add(add(fBL, fBR), add(fTR, fTL))),
    1 / 8
  );

  // Build each plane from three boundary points, then flip the normal so
  // the frustum center always satisfies dot(normal, center) + d < 0.
  const orientedPlane = (a, b, c) => {
    let normal = normalize(cross(sub(b, a), sub(c, a)));
    let d = -dot(normal, a);
    if (dot(normal, frustumCenter) + d > 0) {
      normal = scale(normal, -1);
      d = -d;
    }
    return { normal, d };
  };

  return [
    orientedPlane(nBL, nTL, fTL), // left
    orientedPlane(nBR, fBR, fTR), // right
    orientedPlane(nBL, fBL, fBR), // bottom
    orientedPlane(nTL, nTR, fTR), // top
    orientedPlane(nBL, nBR, nTR), // near
    orientedPlane(fBL, fTL, fTR), // far
  ];
}

// Distance from a point to a plane (negative when inside the frustum).
export function planeDistance(plane, point) {
  return dot(plane.normal, point) + plane.d;
}

// AABB frustum test using the positive vertex method.
// Returns "inside" when all 8 corners are inside every plane,
// "intersect" when the box straddles a plane, and "outside" otherwise.
export function classifyAabb(planes, min, max) {
  const EPS = 1e-6;
  let allInside = true;
  for (const plane of planes) {
    if (plane.invalid) return "intersect";
    const n = plane.normal;
    const pVertex = [
      n[0] >= 0 ? max[0] : min[0],
      n[1] >= 0 ? max[1] : min[1],
      n[2] >= 0 ? max[2] : min[2],
    ];
    if (planeDistance(plane, pVertex) > EPS) return "outside";
    const nVertex = [
      n[0] >= 0 ? min[0] : max[0],
      n[1] >= 0 ? min[1] : max[1],
      n[2] >= 0 ? min[2] : max[2],
    ];
    if (planeDistance(plane, nVertex) > EPS) allInside = false;
  }
  // The positive/negative vertex pair brackets every AABB corner. When all
  // positive vertices are inside but a negative vertex escapes, the box
  // straddles a plane; otherwise the whole box is contained.
  return allInside ? "inside" : "intersect";
}

// Distance from the camera to the closest point of an AABB.
export function distanceToAabb(point, min, max) {
  const closest = [
    clamp(point[0], min[0], max[0]),
    clamp(point[1], min[1], max[1]),
    clamp(point[2], min[2], max[2]),
  ];
  return length(sub(point, closest));
}

// Screen-space error in pixels for a geometric world-space error.
// screenHeight is the render target height in pixels.
export function screenSpaceError(geometricError, distance, fovY, screenHeight) {
  if (geometricError <= 0 || distance <= 0) return 0;
  const projected =
    (geometricError * screenHeight) /
    (Math.tan(fovY / 2) * 2 * Math.max(distance, 1e-6));
  return projected;
}
