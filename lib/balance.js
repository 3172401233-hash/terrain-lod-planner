// Enforces the 2:1 rule: two active leaves that share a boundary segment
// may differ in depth by at most one level. Non-square grids are handled
// by working in sample-space rectangles rather than assuming power-of-two
// dimensions.
//
// The active leaf array is treated as the authoritative frame selection.
// Splitting replaces a node in place with its four children, so a budget
// pass that merged tree leaves without mutating the quadtree stays stable.

function shareBoundary(a, b) {
  const touchX =
    (a.ix0 === b.ix1 || a.ix1 === b.ix0) &&
    a.iz0 < b.iz1 && b.iz0 < a.iz1;
  const touchZ =
    (a.iz0 === b.iz1 || a.iz1 === b.iz0) &&
    a.ix0 < b.ix1 && b.ix0 < a.ix1;
  return touchX || touchZ;
}

function compareId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function enforceBalance(tree, inputLeaves) {
  const forcedSplits = [];
  let blocked = null;
  let leaves = [...inputLeaves];
  let guard = 0;
  const maxIterations = tree.nodes.size * 4 + 32;

  while (guard++ < maxIterations) {
    const toSplit = new Map();

    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i];
        const b = leaves[j];
        if (!shareBoundary(a, b)) continue;
        if (Math.abs(a.depth - b.depth) <= 1) continue;
        const shallow = a.depth < b.depth ? a : b;
        toSplit.set(shallow.id, shallow);
      }
    }

    if (toSplit.size === 0) break;

    const ordered = [...toSplit.values()].sort(compareId);
    let progressed = false;
    for (const node of ordered) {
      if (!leaves.includes(node)) continue;
      const children = tree.split(node);
      if (children === null) {
        blocked = {
          nodeId: node.id,
          depth: node.depth,
          reason: node.depth >= tree.maxDepth ? "maxDepth" : "resolution",
        };
        continue;
      }
      progressed = true;
      forcedSplits.push({
        nodeId: node.id,
        depth: node.depth,
        reason: "balance",
      });
      const index = leaves.indexOf(node);
      leaves.splice(index, 1, ...children);
    }
    if (!progressed) break;
  }

  leaves.sort(compareId);
  return { leaves, forcedSplits, blocked };
}
