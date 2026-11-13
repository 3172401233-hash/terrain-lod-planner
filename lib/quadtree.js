import { TerrainPlanError, ErrorCode } from "./errors.js";

// Quadrant order is fixed for deterministic iteration:
// 0 = left-near, 1 = right-near, 2 = left-far, 3 = right-far.
export const QUADRANTS = Object.freeze(["LN", "RN", "LF", "RF"]);

export class QuadTreeNode {
    constructor({ id, depth, ix0, iz0, ix1, iz1, bounds, geometricError }) {
      this.id = id;
      this.depth = depth;
      this.ix0 = ix0;
      this.iz0 = iz0;
      this.ix1 = ix1;
      this.iz1 = iz1;
      this.bounds = bounds;
      this.geometricError = geometricError;
      this.children = null;
      this.parent = null;
    }

    get sampleColumns() {
      return this.ix1 - this.ix0;
    }

    get sampleRows() {
      return this.iz1 - this.iz0;
    }

    get canSplit() {
      return this.sampleColumns >= 2 && this.sampleRows >= 2;
    }

    get vertexCount() {
      return this.sampleColumns * this.sampleRows;
    }
}

export class TerrainQuadtree {
  constructor(heightmap, maxDepth) {
    if (!Number.isInteger(maxDepth) || maxDepth < 0) {
      throw new TerrainPlanError(
        ErrorCode.INVALID_ARGUMENT,
        "maxDepth must be a non-negative integer",
        { maxDepth }
      );
    }
    this.heightmap = heightmap;
    this.maxDepth = maxDepth;
    this.nodes = new Map();
    const rootDesc = heightmap.describeNode(
      0, 0, heightmap.columns, heightmap.rows
    );
    this.root = new QuadTreeNode({
      id: "root",
      depth: 0,
      ix0: 0,
      iz0: 0,
      ix1: heightmap.columns,
      iz1: heightmap.rows,
      bounds: rootDesc.bounds,
      geometricError: rootDesc.geometricError,
    });
    this.nodes.set(this.root.id, this.root);
    this.depthLimitReached = false;
    this.resolutionLimitReached = false;
    this.effectiveMaxDepth = Math.min(maxDepth, dataMaxDepth(heightmap));
  }

  // Splits a node once and returns the four children (lazily created).
  split(node) {
    if (node.children) return node.children;
    if (node.depth >= this.maxDepth) {
      this.depthLimitReached = true;
      return null;
    }
    if (!node.canSplit) {
      this.resolutionLimitReached = true;
      return null;
    }
    // Split on the midpoint sample. Both children include that border
    // sample (left/top end at midX+1, right/bottom start at midX) so the
    // terrain stays watertight at uniform depth. Patches therefore share
    // border samples but own disjoint cell rectangles; level transitions are
    // stitched by the skirt pass.
    const midX = node.ix0 + Math.floor(node.sampleColumns / 2);
    const midZ = node.iz0 + Math.floor(node.sampleRows / 2);
    const rects = [
      [node.ix0, node.iz0, midX + 1, midZ + 1],
      [midX, node.iz0, node.ix1, midZ + 1],
      [node.ix0, midZ, midX + 1, node.iz1],
      [midX, midZ, node.ix1, node.iz1],
    ];
    const children = rects.map((rect, quadrant) => {
      const [ix0, iz0, ix1, iz1] = rect;
      const desc = this.heightmap.describeNode(ix0, iz0, ix1, iz1);
      const child = new QuadTreeNode({
        id: `${node.id}/${QUADRANTS[quadrant]}`,
        depth: node.depth + 1,
        ix0,
        iz0,
        ix1,
        iz1,
        bounds: desc.bounds,
        geometricError: desc.geometricError,
      });
      child.parent = node;
      this.nodes.set(child.id, child);
      return child;
    });
    node.children = children;
    return children;
  }

  // Depth-first traversal in canonical quadrant order.
  *walk(node = this.root) {
    yield node;
    if (node.children) {
      for (const child of node.children) yield* this.walk(child);
    }
  }

  leaves() {
    const out = [];
    for (const node of this.walk()) {
      if (!node.children) out.push(node);
    }
    return out;
  }

  get maxReachedDepth() {
    let depth = 0;
    for (const node of this.nodes.values()) {
      if (node.depth > depth) depth = node.depth;
    }
    return depth;
  }
}

// Maximum depth at which every cell is its own node (1x1 sample span in
// both dimensions). The configured maxDepth is clamped against this so
// callers asking for more detail than the data supports are told clearly.
export function dataMaxDepth(heightmap) {
  return Math.max(
    Math.ceil(Math.log2(heightmap.columns - 1)),
    Math.ceil(Math.log2(heightmap.rows - 1))
  );
}
