// Skirts are vertical strips hung from the edge of a coarser leaf wherever
// it borders finer leaves. They cover the T-junction gap without changing
// the selected patch set. Each skirt is fully locatable via nodeId + edge
// + sample index so an engine can place vertices without re-deriving them.

export const EDGES = Object.freeze({
  MIN_X: "minX", // western edge, ix = ix0
  MAX_X: "maxX", // eastern edge, ix = ix1 - 1
  MIN_Z: "minZ", // northern edge, iz = iz0
  MAX_Z: "maxZ", // southern edge, iz = iz1 - 1
});

function overlapsX(a, b) {
  return a.iz0 < b.iz1 && b.iz0 < a.iz1;
}

function overlapsZ(a, b) {
  return a.ix0 < b.ix1 && b.ix0 < a.ix1;
}

// For each leaf, inspect the four edges. When any neighbour across an edge
// is one level deeper, emit a skirt for that edge. `drop` extends below the
// lowest local sample so the strip always reaches under the neighbour.
export function generateSkirts(tree, leaves, options = {}) {
  const dropFactor = Number.isFinite(options.skirtDropFactor)
    ? options.skirtDropFactor
    : 1;
  const skirts = [];
  const heightmap = tree.heightmap;

  const sorted = [...leaves].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  for (const leaf of sorted) {
    const edgeDefs = [
      [EDGES.MIN_X, (other) => other.ix1 === leaf.ix0 && overlapsX(leaf, other)],
      [EDGES.MAX_X, (other) => other.ix0 === leaf.ix1 - 1 && overlapsX(leaf, other)],
      [EDGES.MIN_Z, (other) => other.iz1 === leaf.iz0 && overlapsZ(leaf, other)],
      [EDGES.MAX_Z, (other) => other.iz0 === leaf.iz1 - 1 && overlapsZ(leaf, other)],
    ];

    for (const [edge, touches] of edgeDefs) {
      const finerNeighbours = sorted.filter(
        (other) => other !== leaf && touches(other) && other.depth > leaf.depth
      );
      if (finerNeighbours.length === 0) continue;

      const sampleCount = edge === EDGES.MIN_X || edge === EDGES.MAX_X
        ? leaf.sampleRows
        : leaf.sampleColumns;
      let minEdgeHeight = Infinity;
      let maxEdgeHeight = -Infinity;
      for (let k = 0; k < sampleCount; k++) {
        const ix = edge === EDGES.MIN_X ? leaf.ix0
          : edge === EDGES.MAX_X ? leaf.ix1 - 1
          : leaf.ix0 + k;
        const iz = edge === EDGES.MIN_Z ? leaf.iz0
          : edge === EDGES.MAX_Z ? leaf.iz1 - 1
          : leaf.iz0 + k;
        const h = heightmap.heightAt(ix, iz);
        if (h < minEdgeHeight) minEdgeHeight = h;
        if (h > maxEdgeHeight) maxEdgeHeight = h;
      }
      const drop = dropFactor * heightmap.cellSize;
      skirts.push({
        id: `${leaf.id}:${edge}`,
        nodeId: leaf.id,
        edge,
        sampleCount,
        // Extra vertices are the duplicated bottom row; the top row reuses
        // the patch's existing edge vertices.
        extraVertexCount: sampleCount,
        topHeight: { min: minEdgeHeight, max: maxEdgeHeight },
        bottomY: minEdgeHeight - drop,
        drop,
        neighbourIds: finerNeighbours.map((n) => n.id).sort(),
      });
    }
  }
  return skirts;
}
