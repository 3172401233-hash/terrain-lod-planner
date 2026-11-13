// Vertex-budget enforcement.
//
// The quadtree is kept fully split in memory, while a frame's selection is
// an explicit set of active leaf nodes. Coarsening merges a complete
// sibling group into its parent without mutating the tree, which keeps
// repeated runs deterministic and side-effect free.
//
// The engine uploads one vertex buffer per patch, so border samples shared
// by neighbours are submitted twice. The budget counts submitted vertices
// (sum of per-patch counts); merging sibling patches removes duplicated
// borders and therefore reduces the total even when the terrain footprint
// is unchanged.

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function countPatchVertices(leaves) {
  return leaves.reduce((sum, node) => sum + node.vertexCount, 0);
}

export function enforceBudget(tree, initialLeaves, {
  budget,
  sseById,
  balanceFn,
}) {
  const degradation = [];
  let active = new Map(initialLeaves.map((node) => [node.id, node]));
  let total = countPatchVertices([...active.values()]);

  if (total <= budget) {
    return {
      leaves: [...active.values()].sort(byId),
      totalVertices: total,
      degradation,
      budgetSatisfied: true,
      reason: null,
    };
  }

  // The root alone already exceeds the budget: report it explicitly rather
  // than returning an empty world or silently going over budget.
  if (initialLeaves.length === 1 && initialLeaves[0].id === tree.root.id) {
    return {
      leaves: initialLeaves,
      totalVertices: total,
      degradation,
      budgetSatisfied: false,
      reason: "rootExceedsBudget",
    };
  }

  let guard = 0;
  const maxIterations = tree.nodes.size * 2 + 16;

  // Phase 1: coarsen complete sibling groups one LOD level at a time until
  // the unique-vertex budget is met or no legal merge remains.
  while (total > budget && guard++ < maxIterations) {
    const candidates = [];
    const seenParents = new Set();

    for (const leaf of active.values()) {
      const parent = leaf.parent;
      if (!parent || seenParents.has(parent.id)) continue;
      if (!parent.children) continue;
      const group = parent.children.filter((child) => active.has(child.id));
      if (group.length !== parent.children.length) continue;
      seenParents.add(parent.id);
      candidates.push({
        parent,
        group,
        sse: sseById.get(parent.id) ?? parent.geometricError,
      });
    }

    if (candidates.length === 0) break;

    // Smallest visual impact first; node id is the deterministic tie breaker.
    candidates.sort((a, b) =>
      a.sse === b.sse ? byId(a.parent, b.parent) : a.sse - b.sse
    );
    const chosen = candidates[0];
    const beforeVertices = total;
    for (const child of chosen.group) active.delete(child.id);
    active.set(chosen.parent.id, chosen.parent);
    total = countPatchVertices([...active.values()]);
    degradation.push({
      action: "merge",
      parentId: chosen.parent.id,
      mergedIds: chosen.group.map((node) => node.id).sort(),
      removedVertices: beforeVertices - total,
      resultingVertices: total,
      reason: "vertexBudget",
    });
  }

  let leaves = [...active.values()].sort(byId);

  // Phase 2: coarsening complete sibling groups preserves the 2:1 invariant
  // whenever the starting selection was balanced. A defensive rebalance is
  // still available for callers that pass unbalanced input, but it must not
  // run unconditionally because it would undo every budget merge.
  if (balanceFn && hasBalanceViolation(leaves)) {
    const result = balanceFn(tree, leaves);
    if (result.blocked) {
      return {
        leaves,
        totalVertices: total,
        degradation,
        budgetSatisfied: false,
        reason: "balanceBlocked",
      };
    }
    leaves = result.leaves;
    total = countPatchVertices(leaves);
    for (const split of result.forcedSplits) {
      degradation.push({
        action: "split",
        nodeId: split.nodeId,
        depth: split.depth,
        reason: "rebalance",
      });
    }
  }

  return {
    leaves,
    totalVertices: total,
    degradation,
    budgetSatisfied: total <= budget,
    reason: total <= budget ? null : "noLegalMerge",
  };
}

function shareBoundary(a, b) {
  const touchX =
    (a.ix0 === b.ix1 || a.ix1 === b.ix0) &&
    a.iz0 < b.iz1 && b.iz0 < a.iz1;
  const touchZ =
    (a.iz0 === b.iz1 || a.iz1 === b.iz0) &&
    a.ix0 < b.ix1 && b.ix0 < a.ix1;
  return touchX || touchZ;
}

function hasBalanceViolation(leaves) {
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      if (shareBoundary(leaves[i], leaves[j]) &&
          Math.abs(leaves[i].depth - leaves[j].depth) > 1) {
        return true;
      }
    }
  }
  return false;
}
