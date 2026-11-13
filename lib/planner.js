import { Heightmap } from "./heightmap.js";
import { TerrainQuadtree } from "./quadtree.js";
import { buildFrustum } from "./frustum.js";
import {
  classifyAabb,
  distanceToAabb,
  screenSpaceError,
} from "./math.js";
import { enforceBalance } from "./balance.js";
import { generateSkirts } from "./skirt.js";
import { countPatchVertices, enforceBudget } from "./budget.js";
import { TerrainPlanError, ErrorCode } from "./errors.js";

const DEFAULT_OPTIONS = Object.freeze({
  maxDepth: 8,
  screenErrorThreshold: 16,
  maxVertexBudget: Infinity,
  hysteresis: 0.25,
  screenHeight: 1080,
  skirtDropFactor: 1,
});

function comparePatchKey(a, b) {
  return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
}

function patchSortKey(node) {
  // Numeric, order-independent key: row band, column band, depth, id.
  return `${node.iz0}:${node.ix0}:${node.depth}:${node.id}`;
}

export function planTerrain(heightmap, camera, rawOptions = {}, previousPlan = null) {
  if (!(heightmap instanceof Heightmap)) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_ARGUMENT,
      "planTerrain expects a Heightmap instance"
    );
  }
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const {
    maxDepth,
    screenErrorThreshold,
    maxVertexBudget,
    hysteresis,
    screenHeight,
  } = options;

  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_ARGUMENT,
      "maxDepth must be a non-negative integer",
      { maxDepth }
    );
  }
  if (!(screenErrorThreshold > 0) || !Number.isFinite(screenErrorThreshold)) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_ARGUMENT,
      "screenErrorThreshold must be a positive finite number"
    );
  }
  if (!(maxVertexBudget > 0) ||
      (!Number.isFinite(maxVertexBudget) && maxVertexBudget !== Infinity)) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_ARGUMENT,
      "maxVertexBudget must be a positive finite number or Infinity"
    );
  }
  if (!(hysteresis >= 0 && hysteresis < 1)) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_ARGUMENT,
      "hysteresis must satisfy 0 <= hysteresis < 1",
      { hysteresis }
    );
  }
  if (!Number.isInteger(screenHeight) || screenHeight <= 0) {
    throw new TerrainPlanError(
      ErrorCode.INVALID_ARGUMENT,
      "screenHeight must be a positive integer",
      { screenHeight }
    );
  }

  const frustum = buildFrustum(camera);
  const highThreshold = screenErrorThreshold * (1 + hysteresis);
  const lowThreshold = screenErrorThreshold * (1 - hysteresis);

  const tree = new TerrainQuadtree(heightmap, maxDepth);
  const previousLeaves = new Set(
    previousPlan && Array.isArray(previousPlan.patchIds)
      ? previousPlan.patchIds
      : []
  );

  const sseById = new Map();
  const culledNodes = [];
  const errorSplits = [];

  const computeSse = (node) => {
    const distance = distanceToAabb(
      frustum.position, node.bounds.min, node.bounds.max
    );
    const sse = screenSpaceError(
      node.geometricError, distance, frustum.fovY, screenHeight
    );
    sseById.set(node.id, sse);
    return { sse, distance };
  };

  // ---- Pass 1: frustum culling + error-driven splitting (with hysteresis).
  let frontier = [tree.root];
  const rootVisibility = classifyAabb(
    frustum.planes, tree.root.bounds.min, tree.root.bounds.max
  );
  if (rootVisibility === "outside") {
    return buildEmptyPlan({
      tree, options, camera, reason: "rootCulled",
      highThreshold, lowThreshold,
    });
  }
  computeSse(tree.root);

  let guard = 0;
  const maxIterations = tree.nodes.size * 8 + 64;
  while (guard++ < maxIterations) {
    const nextFrontier = [];
    let changed = false;

    for (const node of frontier) {
      const { sse } = computeSse(node);
      const wasLeaf = previousLeaves.has(node.id);
      // A node currently kept coarse from the previous frame only splits
      // once error crosses the higher threshold; everything else uses the
      // lower merge threshold, producing switching hysteresis.
      const threshold = wasLeaf ? highThreshold : lowThreshold;
      const wantsSplit = node.geometricError > 0 && sse > threshold;

      if (!wantsSplit || node.depth >= tree.maxDepth || !node.canSplit) {
        if (wantsSplit && node.depth >= tree.maxDepth) {
          tree.depthLimitReached = true;
        }
        if (wantsSplit && !node.canSplit) {
          tree.resolutionLimitReached = true;
        }
        nextFrontier.push(node);
        continue;
      }

      const children = tree.split(node);
      if (children === null) {
        nextFrontier.push(node);
        continue;
      }
      changed = true;
      errorSplits.push({ nodeId: node.id, depth: node.depth, sse });

      for (const child of children) {
        const visibility = classifyAabb(
          frustum.planes, child.bounds.min, child.bounds.max
        );
        if (visibility === "outside") {
          culledNodes.push({ nodeId: child.id, depth: child.depth });
          continue;
        }
        nextFrontier.push(child);
      }
    }

    frontier = nextFrontier;
    if (!changed) break;
  }

  // ---- Pass 2: enforce 2:1 neighbour balance.
  const balanceResult = enforceBalance(tree, frontier);
  // Balance-created children still need culling and SSE values.
  const visibleLeaves = [];
  for (const node of balanceResult.leaves) {
    if (!sseById.has(node.id)) computeSse(node);
    const visibility = classifyAabb(
      frustum.planes, node.bounds.min, node.bounds.max
    );
    if (visibility === "outside") {
      culledNodes.push({ nodeId: node.id, depth: node.depth });
      continue;
    }
    visibleLeaves.push(node);
  }

  // ---- Pass 3: vertex budget with explicit, ordered degradation.
  const beforeBudgetVertices = countPatchVertices(visibleLeaves);
  const budgetResult = enforceBudget(tree, visibleLeaves, {
    budget: maxVertexBudget,
    sseById,
    balanceFn: enforceBalance,
  });

  // Re-cull merged parents: a merge can reintroduce a node that was never
  // cull-tested itself, though all its visible children passed.
  const finalLeaves = budgetResult.leaves.filter((node) => {
    const visibility = classifyAabb(
      frustum.planes, node.bounds.min, node.bounds.max
    );
    if (visibility === "outside") {
      culledNodes.push({ nodeId: node.id, depth: node.depth });
      return false;
    }
    return true;
  });

  // ---- Pass 4: skirts for level transitions.
  const skirts = generateSkirts(tree, finalLeaves, options);

  // ---- Pass 5: deterministic patches with contiguous index ranges.
  const orderedLeaves = [...finalLeaves].sort((a, b) =>
    comparePatchKey({ sortKey: patchSortKey(a) }, { sortKey: patchSortKey(b) })
  );
  const orderedSkirts = [...skirts].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  const patches = [];
  let indexOffset = 0;
  for (const node of orderedLeaves) {
    const indexCount = (node.sampleColumns - 1) * (node.sampleRows - 1) * 6;
    patches.push({
      nodeId: node.id,
      sortKey: patchSortKey(node),
      sampleRect: {
        ix0: node.ix0, iz0: node.iz0, ix1: node.ix1, iz1: node.iz1,
      },
      bounds: node.bounds,
      depth: node.depth,
      vertexCount: node.vertexCount,
      geometricError: node.geometricError,
      screenSpaceError: sseById.get(node.id) ?? 0,
      indexRange: { start: indexOffset, count: indexCount },
    });
    indexOffset += indexCount;
  }

  const skirtOutputs = [];
  for (const skirt of orderedSkirts) {
    const indexCount = (skirt.sampleCount - 1) * 6;
    skirtOutputs.push({
      ...skirt,
      indexRange: { start: indexOffset, count: indexCount },
    });
    indexOffset += indexCount;
  }

  const totalPatchVertices = countPatchVertices(orderedLeaves);
  const totalSkirtVertices = orderedSkirts.reduce(
    (sum, skirt) => sum + skirt.extraVertexCount, 0
  );
  const rootOnly = orderedLeaves.length === 1 &&
    orderedLeaves[0].id === tree.root.id;
  const budgetExceeded = !budgetResult.budgetSatisfied;

  const rootVertices = tree.root.vertexCount;
  const rootOverBudget = rootOnly && rootVertices > maxVertexBudget;
  const status = culledNodes.length > 0 && orderedLeaves.length === 0
    ? "fullyCulled"
    : budgetExceeded
      ? rootOverBudget
        ? "degradedRootOverBudget"
        : budgetResult.reason === "noLegalMerge"
          ? "degradedNoLegalMerge"
          : "degradedBudget"
      : "ok";

  return {
    status,
    patches,
    skirts: skirtOutputs,
    patchIds: orderedLeaves.map((node) => node.id),
    stats: {
      patchCount: patches.length,
      skirtCount: skirtOutputs.length,
      totalPatchVertices,
      totalSkirtVertices,
      totalIndexCount: indexOffset,
      maxReachedDepth: tree.maxReachedDepth,
      configuredMaxDepth: maxDepth,
      effectiveMaxDepth: tree.effectiveMaxDepth,
      depthLimitReached: tree.depthLimitReached,
      resolutionLimitReached: tree.resolutionLimitReached,
      balanceBlocked: balanceResult.blocked,
      culledNodeCount: culledNodes.length,
      errorSplitCount: errorSplits.length,
      balanceSplitCount: balanceResult.forcedSplits.length,
      beforeBudgetVertices,
      vertexBudget: maxVertexBudget,
      budgetExceeded,
      rootOnlyFallback: rootOnly,
      rootOverBudget,
      rootVertices,
      budgetReason: budgetResult.reason ?? null,
      thresholds: { low: lowThreshold, high: highThreshold },
    },
    degradation: budgetResult.degradation,
    culled: culledNodes.sort((a, b) =>
      a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0
    ),
  };
}

function buildEmptyPlan({ tree, options, reason, highThreshold, lowThreshold }) {
  return {
    status: "fullyCulled",
    patches: [],
    skirts: [],
    patchIds: [],
    stats: {
      patchCount: 0,
      skirtCount: 0,
      totalPatchVertices: 0,
      totalSkirtVertices: 0,
      totalIndexCount: 0,
      maxReachedDepth: 0,
      configuredMaxDepth: options.maxDepth,
      effectiveMaxDepth: tree.effectiveMaxDepth,
      depthLimitReached: false,
      resolutionLimitReached: false,
      balanceBlocked: null,
      culledNodeCount: 1,
      errorSplitCount: 0,
      balanceSplitCount: 0,
      beforeBudgetVertices: 0,
      vertexBudget: options.maxVertexBudget,
      budgetExceeded: false,
      rootOnlyFallback: false,
      rootOverBudget: false,
      rootVertices: tree.root.vertexCount,
      budgetReason: null,
      thresholds: { low: lowThreshold, high: highThreshold },
    },
    degradation: [],
    culled: [{ nodeId: tree.root.id, depth: 0, reason }],
  };
}
