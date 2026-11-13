# terrain-lod-planner

零第三方依赖、纯 CPU 的 Node.js 地形 LOD 规划库。给定规则高度图与相机参数，
它决定每一帧需要提交哪些地形 patch，并输出 patch、索引范围、skirt 裂缝数据
和统计信息。库本身不实现渲染器或界面，只产出引擎可直接消费的数据。

- 纯 ESM，仅使用 Node.js 内置模块（`node:test` 跑测试）
- 无 GPU、无原生依赖、无 `node_modules`
- 要求 Node.js `>= 20`

## 快速上手

```js
import { Heightmap, planTerrain } from "terrain-lod-planner";

const columns = 33;
const rows = 33;
const heights = new Float64Array(columns * rows);
for (let iz = 0; iz < rows; iz++) {
  for (let ix = 0; ix < columns; ix++) {
    heights[iz * columns + ix] = Math.sin(ix * 0.2) * 10;
  }
}

const heightmap = new Heightmap({
  columns,
  rows,
  cellSize: 10,
  heights,
  origin: { x: 0, z: 0 },
});

const camera = {
  position: [160, 260, -160],
  forward: [0, -0.75, 1],
  up: [0, 1, 0],
  fovY: Math.PI / 2.2,
  aspect: 16 / 9,
  near: 1,
  far: 1000,
};

const plan = planTerrain(heightmap, camera, {
  maxDepth: 5,
  screenErrorThreshold: 16,
  maxVertexBudget: 5000,
  hysteresis: 0.25,
  screenHeight: 1080,
});

for (const patch of plan.patches) {
  // patch.sampleRect / patch.bounds / patch.indexRange / patch.vertexCount
}
for (const skirt of plan.skirts) {
  // skirt.nodeId / skirt.edge / skirt.bottomY / skirt.indexRange
}
```

## 输出结构

`planTerrain` 返回：

| 字段 | 说明 |
| --- | --- |
| `status` | `ok` / `fullyCulled` / `degradedBudget` / `degradedNoLegalMerge` / `degradedRootOverBudget` |
| `patches` | 稳定排序的可见 patch，含样本矩形、包围盒、深度、几何/屏幕误差、顶点数与索引范围 |
| `skirts` | 层级接边处的垂直裙边数据，可通过 `nodeId + edge` 定位 |
| `patchIds` | 上一帧 hysteresis 需要的 patch id 快照 |
| `stats` | patch/skirt 数量、顶点与索引总量、深度限制、裁剪数、降级原因等 |
| `degradation` | 预算降级的有序操作记录（每次合并的父节点、被合并 id、顶点变化） |
| `culled` | 被视锥剔除的节点 |

所有 `indexRange` 在 patch 与 skirt 之间连续且互不重叠，`totalIndexCount`
为它们的总和。patch 按数字排序键（行带、列带、深度、节点 id）排列，
相同输入永远得到相同顺序，与对象插入顺序无关。

## 算法流程

1. **视锥构建与校验**：由相机基向量和投影参数直接构造六个朝外平面，
   零向量、平行 up/fov、近远平面、宽高比等非法输入抛出
   `TerrainPlanError(INVALID_FRUSTUM)`。
2. **误差驱动分裂**：自顶向下遍历四叉树，用节点包围盒到相机的距离和
   几何误差计算屏幕空间误差（像素），超过阈值才分裂。
3. **视锥裁剪**：正顶点（positive vertex）AABB 测试，完全在外的子树被剔除。
4. **2:1 平衡**：相邻叶子深度差不得超过一级，违规的浅节点按节点 id
   顺序强制分裂。
5. **顶点预算**：超预算时按“屏幕误差最小的可合并兄弟组”优先合并，
   逐步粗化直到满足预算或无法继续。
6. **skirt 生成**：粗节点在与更细邻居接壤的每条边生成可定位的裙边，
   裙边底边低于该边最低样本，盖住 T 型接缝。
7. **稳定拼装**：排序并分配连续索引范围，输出 patch、skirt 与统计。

## 关键设计与边界处理

- **非正方形高度图**：所有分裂、邻居检测、平衡都在样本空间矩形上进行，
  不假设边长是 2 的幂。
- **最大深度不足**：`maxDepth` 低于数据分辨率时不抛异常，而是在
  `stats.depthLimitReached` / `resolutionLimitReached` 中显式标记，
  仍返回可渲染结果。
- **零几何误差**：完全平坦的节点 `geometricError === 0`，不会因误差分裂，
  只在平衡需要时分裂。
- **预算无法满足**：不会悄然超预算，也不会返回空地形。
  - 还能合并时持续粗化，并在 `degradation` 记录每一步；
  - 当根节点本身就超过预算时，返回 `status: "degradedRootOverBudget"`、
    非空的根 patch、`stats.rootOverBudget === true` 和明确的 `budgetReason`。
- **切换 hysteresis**：传入上一帧 plan 作为第四参数，上一帧保留的粗节点
  使用更高的分裂阈值，其他节点使用更低的合并阈值，避免相机轻微移动时
  LOD 反复抖动。
- **确定性**：分裂、平衡、合并、排序全部使用固定的象限顺序和 id 比较，
  重复运行结果逐字节一致。
- **patch 不互相覆盖**：相邻 patch 允许共享边界样本（保证水密），
  但它们拥有的单元格矩形互不重叠。

## 顶点预算口径

引擎为每个 patch 独立分配顶点缓冲区，因此预算统计的是各 patch
`vertexCount` 之和，边界样本在相邻 patch 间会被重复提交。LOD 越深、
patch 越多，重复边界顶点越多，所以合并兄弟组能够稳定降低提交顶点数。

## 测试

```bash
node --test
# 或
npm test
```

测试用程序化生成的小尺寸高度图（平坦、波浪、山脊、球面）和相机数据，
覆盖四叉树分裂、视锥内外、2:1 平衡、skirt 定位、预算降级、hysteresis、
非正方形地形、无效视锥、零误差与重复运行确定性。

## 模块划分

| 文件 | 职责 |
| --- | --- |
| `lib/math.js` | 向量/矩阵、视锥平面、AABB 裁剪、屏幕误差 |
| `lib/heightmap.js` | 规则高度图、样本到世界坐标、节点几何误差 |
| `lib/quadtree.js` | 受限深度四叉树、惰性分裂、规范象限顺序 |
| `lib/frustum.js` | 相机校验与视锥构建 |
| `lib/balance.js` | 2:1 邻居平衡 |
| `lib/skirt.js` | 层级接缝裙边数据 |
| `lib/budget.js` | 顶点预算与有序降级 |
| `lib/planner.js` | 串联全部阶段的主规划器 |
| `lib/errors.js` | 带稳定错误码的异常类型 |
