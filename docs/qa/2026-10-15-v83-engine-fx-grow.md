# v83 引擎特效随 LOD 淡入（修"只有尾焰没有舰船"）

日期：2026-10-15。用户实报：
> 这个金色的尾焰，只有尾焰，没有舰船，是错位还是？

---

## 1. 金色来源定位

`battleFx.buildEngineFx` 返回两个网格：

| 网格 | 材质色 | 基准不透明度 |
|---|---|---|
| `flame`（白核） | `0xffffff` | 0.9 |
| **`glow`（暖晕）** | **`0xffcc66`（琥珀金）** | **0.55** |

⇒ 用户看到的金色竖条 = **`glow`（引擎暖晕）**，不是尾焰粒子
（粒子是 `hot = vec3(1.00,0.92,0.72)` 暖白，尺寸仅 1~3px，与"竖条"形态不符）。

## 2. 根因：线框渲染与面片特效的"可见性不同步"

- **舰体 = 线条化渲染（Line）** ⇒ 缩小时**线宽变细直至不可见**
- **`glow` = 面片 + `AdditiveBlending`** ⇒ **不随实体缩小而消失**

⇒ 中等距离下「线框已经看不见，`glow` 还亮着」⇒ **"无舰之焰"**。

**且 `glow` 的 opacity 从未被更新**（全项目只在 `buildEngineFx` 创建时设一次 0.55）
⇒ 与 LOD 的 `grow` **完全脱钩**。

## 3. 修复

```ts
const _gm = entry.glow?.material as THREE.MeshBasicMaterial | undefined;
if (_gm) _gm.opacity = GLOW_BASE_OPACITY * v.grow;      // 0.55 × grow
const _fm = entry.flame?.material as THREE.MeshBasicMaterial | undefined;
if (_fm) _fm.opacity = FLAME_BASE_OPACITY * v.grow;     // 0.9 × grow
```

位置在**每帧的实体更新循环**内（`v.grow` 赋值之后，4119 附近；该循环在 `addMesh` 定义之前
⇒ 确认是每帧执行的路径，非仅新建时）。

| `grow` | 含义 | `glow.opacity` |
|---|---|---|
| 0（px ≤ 12） | 实体极小/未起 | **0**（全隐） |
| 0.5 | 中景 | 0.275 |
| 1（px ≥ 24） | 近景实心 | 0.55（原值） |

⇒ 特效与舰体的可见性**严格同步**，不再出现"只有尾焰"。

## 4. 门槛

全量台架 **30/30 绿** · `vue-tsc` EXIT=0 · `go build` EXIT=0

## 5. 未闭合

- 若用户在**远景**仍希望看到引擎辉光（作为"雷达亮点"），本修复会让它消失。
  届时可给 `glow.opacity` 加一个下限（如 `max(0.15, 0.55×grow)`）。
- 线条化渲染在中等距离**本身就会淡出** ⇒ 这是"看不见舰船"的更根本原因；
  若用户希望中景也有可辨舰体，需另议（提高线宽 / 中景改用简模）。

## 6. 产物

- `frontend/src/game/three/Battle3DOverlay.ts`：`GLOW_BASE_OPACITY` / `FLAME_BASE_OPACITY` + `grow` 缩放
- 本台账
