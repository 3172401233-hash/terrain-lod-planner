import { TerrainPlanError, ErrorCode } from "./errors.js";

// A regular, axis-aligned height field.
//
// columns * rows height samples are laid out row-major (iz * columns + ix).
// The world footprint is (columns - 1) * cellSize wide and
// (rows - 1) * cellSize deep, so non-square terrain is a first-class case.
export class Heightmap {
  constructor({ columns, rows, cellSize, heights, origin, heightScale = 1 }) {
    if (!Number.isInteger(columns) || columns < 2) {
      throw new TerrainPlanError(
        ErrorCode.INVALID_ARGUMENT,
        "heightmap columns must be an integer >= 2",
        { columns }
      );
    }
    if (!Number.isInteger(rows) || rows < 2) {
      throw new TerrainPlanError(
        ErrorCode.INVALID_ARGUMENT,
        "heightmap rows must be an integer >= 2",
        { rows }
      );
    }
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) {
      throw new TerrainPlanError(
        ErrorCode.INVALID_ARGUMENT,
        "cellSize must be a positive finite number",
        { cellSize }
      );
    }
    if (!Array.isArray(heights) && !(heights instanceof Float64Array) &&
        !(heights instanceof Float32Array)) {
      throw new TerrainPlanError(
        ErrorCode.INVALID_ARGUMENT,
        "heights must be an array or typed array of samples"
      );
    }
    if (heights.length !== columns * rows) {
      throw new TerrainPlanError(
        ErrorCode.INVALID_ARGUMENT,
        "heights length must equal columns * rows",
        { expected: columns * rows, actual: heights.length }
      );
    }
    this.columns = columns;
    this.rows = rows;
    this.cellSize = cellSize;
    this.heightScale = heightScale;
    this.origin = {
      x: origin && Number.isFinite(origin.x) ? origin.x : 0,
      z: origin && Number.isFinite(origin.z) ? origin.z : 0,
    };
    // Normalize storage to Float64Array for deterministic numerics.
    this.heights =
      heights instanceof Float64Array ? heights : Float64Array.from(heights);
    this.width = (columns - 1) * cellSize;
    this.depth = (rows - 1) * cellSize;
  }

  index(ix, iz) {
    return iz * this.columns + ix;
  }

  heightAt(ix, iz) {
    return this.heights[this.index(ix, iz)] * this.heightScale;
  }

  worldX(ix) {
    return this.origin.x + ix * this.cellSize;
  }

  worldZ(iz) {
    return this.origin.z + iz * this.cellSize;
  }

  // World-space AABB and bilinear-corner geometric error for a sample
  // rectangle [ix0, ix1) x [iz0, iz1).
  describeNode(ix0, iz0, ix1, iz1) {
    let minY = Infinity;
    let maxY = -Infinity;
    let maxDeviation = 0;
    const h00 = this.heightAt(ix0, iz0);
    const h10 = this.heightAt(ix1 - 1, iz0);
    const h01 = this.heightAt(ix0, iz1 - 1);
    const h11 = this.heightAt(ix1 - 1, iz1 - 1);
    const spanX = ix1 - 1 - ix0;
    const spanZ = iz1 - 1 - iz0;

    for (let iz = iz0; iz < iz1; iz++) {
      for (let ix = ix0; ix < ix1; ix++) {
        const h = this.heightAt(ix, iz);
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
        // Bilinear baseline built from the four corners of the node.
        const tx = spanX === 0 ? 0 : (ix - ix0) / spanX;
        const tz = spanZ === 0 ? 0 : (iz - iz0) / spanZ;
        const baseline =
          h00 * (1 - tx) * (1 - tz) +
          h10 * tx * (1 - tz) +
          h01 * (1 - tx) * tz +
          h11 * tx * tz;
        const deviation = Math.abs(h - baseline);
        if (deviation > maxDeviation) maxDeviation = deviation;
      }
    }

    return {
      bounds: {
        min: [this.worldX(ix0), minY, this.worldZ(iz0)],
        max: [this.worldX(ix1 - 1), maxY, this.worldZ(iz1 - 1)],
      },
      // Vertical deviation is treated as the node's geometric (world) error.
      geometricError: maxDeviation,
    };
  }
}

// Convenience factory used by tests and engine code alike.
export function createHeightmap(options) {
  return new Heightmap(options);
}
