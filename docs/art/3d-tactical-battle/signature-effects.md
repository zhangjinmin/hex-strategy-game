# 3D 战术战斗层三大招牌特效规格

特效设计必须遵守用户明确要求：**从第一性原理出发，拒绝“渐变圆 + 透明度”的表面化方案**。

## 1. 护盾涟漪（Shield Ripple）

### 1.1 2D 现状参数（必须传承）

来源：`BattleScene.ts` 行 2057-2083、2963-2995。

| 参数 | 值 |
|------|-----|
| 初始椭圆半径 | rx = 14，ry = 8（像素） |
| 结束椭圆半径 | rx = 32，ry = 18（像素） |
| 初始弧张角 | span = 0.45 rad（±25.8°） |
| 结束弧张角 | span = π × 0.6 ≈ 1.885 rad（±108°） |
| 时长 | 1100 ms（除以 dt） |
| 缓动 | Sine.easeOut |
| 线宽 | max(0.4, 2-3 × alpha) |
| 透明度 | 1 → 0 |
| 形状 | **仅弧边，无填充，无弦线** |
| 尺寸关系 | 护盾远大于舰体（舰体 r≈4-8，护盾 rx=14→32） |

### 1.2 3D 实现路径

推荐方案：**球面弧线（Spherical Arc）**，既符合“球形护盾”的文字描述，又保留 2D 的椭圆投影外观。

#### 方案 A：球面 RingGeometry 片段（推荐）

- 几何：`RingGeometry(innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength)` 的一部分。
- 将 RingGeometry 弯曲贴到球面上：使用自定义 `BufferGeometry`，顶点沿球面分布。
- 更简单的做法：先用 RingGeometry 生成平面环片段，再对其顶点做球面投影（将 z 设为 `sqrt(r² - x² - y²)` 并归一化）。
- 材质：`MeshBasicMaterial`，`transparent: true`，`blending: THREE.AdditiveBlending`，`side: THREE.DoubleSide`，`depthWrite: false`。
- 由于 ring 很薄（tube 小），视觉上就是“纯弧线无填充”。

#### 方案 B：线段式 billboard 弧（备选）

- 用 `THREE.Line` + 自定义 BufferGeometry，在片段着色器中始终面向相机（billboard）。
- 优点：与 2D 完全一致；缺点：在 3D 旋转中扁平感强。
- 仅当方案 A 视觉验证失败时使用。

### 1.3 参数映射到 3D

| 2D 参数 | 3D 对应 | 说明 |
|---------|---------|------|
| rx = 14 → 32 | 球面弧在“撞击切面”上的水平半径 | 对应护盾球体的截面椭圆长轴 |
| ry = 8 → 18 | 球面弧的垂直半径 | 对应截面椭圆短轴（ry/rx ≈ 0.57） |
| span 0.45 → 1.885 | 球面弧的 thetaLength | 从撞击点向两侧扩散 |
| impactAngleRad | 球面弧的 thetaStart = impactAngle - span/2 | 弧中心对准受击方向 |
| 线宽 2-3×alpha | ring 的 tube 半径或 Line 宽度 | 随 alpha 衰减变细 |

### 1.4 时序与颜色

```ts
// 伪代码
tweens.add({
  targets: ripple,
  rx: 32,
  ry: 18,
  span: Math.PI * 0.6,
  alpha: 0,
  duration: 1100 / dt,
  ease: 'Sine.easeOut',
});
```

- 颜色：`shieldColor = tFac ? tFac.color : 0x06b6d4`（与 2D 一致）。
- 同时保留受击点白光闪现：`Circle`/`Sphere` 半径 0.2，alpha 1→0，时长 200 ms。

### 1.5 关键约束

- **禁止画闭合圆环**：护盾涟漪是局部弧，不是整圆。
- **禁止填充面**：只能看到弧边，弧内部必须是透明的。
- **禁止弦线**：弧的两个端点之间不能连线。
- 护盾球体半径应大于舰体包围盒 1.5-2.0 倍。

## 2. 激光束（Battleship Main Cannon）

### 2.1 2D 现状参数

来源：`BattleScene.ts` 行 2938-2943。

| 参数 | 值 |
|------|-----|
| 外层 | 矩形，宽 = dist，高 = 2 px，color = faction 色，origin = (0, 0.5)，rotation = fireAngle，Additive，alpha = 0.7 |
| 内核 | 矩形，宽 = dist，高 = 0.8 px，color = 0xffffff，origin = (0, 0.5)，alpha = 0.9 |
| 时长 | 900 ms（除以 dt） |
| 缓动 | Expo.easeOut |
| 淡出 | alpha 1 → 0 |

要塞激光另有分层：70px 宽橙 → 32px 金 → 14px 白，带端帽圆。战术舰主炮保持“细束”风格。

### 2.2 3D 实现路径

推荐方案：**圆柱体 + 圆柱体**，或 **拉伸 Box**。圆柱在端点自然圆整，更适合“光束”语义。

#### 几何

```ts
// 外层辉光
const outerGeo = new THREE.CylinderGeometry(0.12, 0.12, dist, 8, 1, true);
outerGeo.rotateX(Math.PI / 2); // 默认圆柱沿 Y，转为沿 Z
outerGeo.translate(0, 0, dist / 2); // origin 移到一端

// 内核
const coreGeo = new THREE.CylinderGeometry(0.04, 0.04, dist, 8, 1, true);
coreGeo.rotateX(Math.PI / 2);
coreGeo.translate(0, 0, dist / 2);
```

或使用 `BufferGeometry` 拉伸一条 `THREE.Line` 成管状（`TubeGeometry`）以获得更柔和辉光，但面数更高。

#### 材质

| 层级 | 材质 | 参数 |
|------|------|------|
| 外层 | `MeshBasicMaterial` | color = faction 色，transparent，opacity = 0.5，AdditiveBlending，depthWrite = false，side = THREE.DoubleSide |
| 内核 | `MeshBasicMaterial` | color = 0xffffff，transparent，opacity = 0.9，AdditiveBlending，depthWrite = false，side = THREE.DoubleSide |

#### 对齐

- 起点：射击舰船尾部/侧舷炮口（需在舰船几何上预留 muzzle 空物体）。
- 方向：射击者指向目标。
- 长度：起点到目标距离。
- 朝向：使用 `lookAt(target)` 后平移。

### 2.3 时序

```ts
tweens.add({
  targets: [outerMesh, coreMesh],
  alpha: 0,
  duration: 900 / dt,
  ease: 'Expo.easeOut',
  onComplete: () => { outerMesh.dispose(); coreMesh.dispose(); }
});
```

### 2.4 命中反馈

- 目标舰船护盾涟漪（见上）。
- 目标舰体闪烁：将舰体材质 opacity 临时提高到 1.0 或颜色切到白色，100 ms 后恢复。
- 小型命中光晕：在命中点生成一个 0.3 半径的白色 Additive 球体，scale 0.1→1.5，alpha 1→0，时长 200 ms。

### 2.5 要塞激光（Thor's Hammer 类）

若将来要塞激光也需要 3D 化，沿用分层逻辑：

| 层 | 半径 | 颜色 | alpha | 延迟 |
|----|------|------|-------|------|
| 外层能量柱 | 0.8-1.0 | `0xf97316` | 0.7 | 0 ms |
| 中层 | 0.35-0.45 | `0xfbbf24` | 0.85 | 100 ms |
| 核心 | 0.15-0.2 | `0xffffff` | 0.95 | 200 ms |

两端加半球/圆柱帽，避免平切。

## 3. 战舰尾焰（Engine Exhaust）

### 3.1 2D 现状参数

来源：`BattleScene.ts` 行 707-712、2779-2794。

| 参数 | 值 |
|------|-----|
| 贴图 | `flame.png`（48×16，宽高比 3:1） |
| 尺寸 | flameLen × flameLen/3 |
| 位置 | 舰船尾部 local (-shipLen/2, 0) |
| 可见条件 | 移动时（isMoving，uDist > 5） |
| 闪烁 | alpha = flicker × (0.85 + speedFactor × 0.15) |
| flicker | 0.75 + sin(phase×1.3)×0.20 + sin(phase×2.7)×0.08 |
| 脉动 scaleX | 0.85 + sin(phase×1.7)×0.12 + speedFactor×0.08 |
| 脉动 scaleY | 0.90 + sin(phase×2.1)×0.08 + speedFactor×0.05 |
| phase | time × 0.018 + index × 0.7 |

### 3.2 3D 实现路径

> **状态：待拍板**。用户指示等工程侧架构与性能预算出来后一起定。下方 A/B 两方案均保留，供对账后选择。
> **两者都必须拒绝“渐变圆片 + 透明度”的表面化方案**（用户明确要求）。

#### 方案总览

| | **方案 A：程序化 cone + Shader** | **方案 B：粒子系统** |
|---|---|---|
| 核心思路 | 一个锥体网格，用顶点着色器做湍流扰动与纵向渐变 | 从喷口持续发射短生命周期 billboard 粒子 |
| 自然度来源 | GLSL 顶点扰动（确定性） | 粒子随机性 + 拖尾（天然） |

#### 方案 A：程序化锥形 + 顶点扰动 Shader

##### 几何

```ts
// 锥形：底部在引擎喷口，尖端朝后
const coneGeo = new THREE.ConeGeometry(baseRadius, length, 16, 8, true);
coneGeo.rotateX(-Math.PI / 2); // 尖端朝 +Z 转为朝 -Z（尾部）
coneGeo.translate(0, 0, -length / 2);
```

或更真实的 **截断锥体（CylinderGeometry）**，底部半径大、顶部半径小：

```ts
const exhaustGeo = new THREE.CylinderGeometry(tipRadius, baseRadius, length, 16, 8, true);
exhaustGeo.rotateX(-Math.PI / 2);
exhaustGeo.translate(0, 0, -length / 2);
```

单 cone 面数：16 边 × 8 段 × 2 = **64 tris**（可按需降到 12×4=32）。

#### 材质与 Shader

使用 `ShaderMaterial`，在顶点阶段做湍流扰动：

```glsl
uniform float uTime;
uniform float uFlicker;
uniform float uSpeedFactor;
varying vec2 vUv;
varying float vAlpha;

void main() {
  vUv = uv;
  vec3 pos = position;

  // 沿尾焰长度方向做湍流摆动
  float t = uTime * 8.0 + uv.y * 4.0;
  float wave = sin(t) * 0.08 * (1.0 - uv.y); // 尖端摆动更大
  pos.x += wave;
  pos.z += cos(t * 1.3) * 0.05 * (1.0 - uv.y);

  // 半径随 flicker 呼吸
  float breathe = 0.9 + uFlicker * 0.2 + uSpeedFactor * 0.1;
  pos.x *= breathe;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  vAlpha = 0.6 + uFlicker * 0.3 + uSpeedFactor * 0.15;
}
```

片段着色器：

```glsl
uniform vec3 uCoreColor;
uniform vec3 uTipColor;
varying vec2 vUv;
varying float vAlpha;

void main() {
  // 纵向渐变：底部亮，尖端暗且透明
  float grad = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
  // 径向渐变：中心亮，边缘淡出
  float radial = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float a = grad * radial * vAlpha;
  vec3 col = mix(uTipColor, uCoreColor, grad);
  gl_FragColor = vec4(col, a);
}
```

#### 方案 B：粒子系统

从喷口持续发射短生命周期粒子，用 `Points` 或 instanced billboard quads 渲染。

```ts
// 每舰 1-2 个发射器，每发射器 ~30 颗粒子
// 粒子属性：position / velocity（沿 -Z 舰尾方向 + 随机扰动）/ age / lifetime / size / seed
const exhaustGeo = new THREE.InstancedBufferGeometry();  // 或 THREE.BufferGeometry + Points
// 单个粒子 = 1 个 billboard quad = 2 tris
```

粒子在着色器中按 `age / lifetime` 做**尺寸膨胀 + 颜色退色 + alpha 衰减**：

| 生命周期阶段 | 尺寸 | 颜色 | alpha |
|-------------|------|------|-------|
| 0%（喷口） | 0.4 × 基准 | 近白/高温色 `0xffffff` → `0xffcc66` | 0.9 |
| 40% | 1.0 × 基准 | 阵营色 → 尾焰色 | 0.7 |
| 100%（消散） | 1.8 × 基准 | 暗淡阵营色 | 0.0 |

闪烁与脉动通过**发射速率与初速度抖动**实现，而非逐个粒子改 alpha（避免 CPU 每帧写 buffer）。

单粒子面数：1 quad = **2 tris**。

#### 方案对比（对账用）

| 维度 | **方案 A：cone + Shader** | **方案 B：粒子系统** |
|------|---------------------------|----------------------|
| 粒子数 | **~800**（仅爆炸/损毁） | **~2,720**（32 舰 × 1.5 发射器 × 30 + 爆炸 800） |
| 三角面 | **+3,072**（48 cones × 64 tris） | **+5,440**（2,720 quads × 2 tris） |
| Draw call | **+16**（按舰种合并/instanced） | **+1**（单个 Points / instanced quads） |
| **Overdraw 影响** | **低**：实心锥体，层数可预测（1 层） | **高**：粒子互相重叠，局部可达 6-10 层 |
| 与「4 层半透明上限」冲突 | 无 | **有冲突风险**（见 `materials-and-lighting.md` §7.2） |
| 视觉自然度 | 中：形状规整，湍流靠 shader 模拟 | **高**：天然拖尾、消散、随机感 |
| GC / CPU 压力 | 低（对象池，无每帧分配） | 中（粒子池管理不当易产生 GC spike） |
| 实现复杂度 | 中（需写 GLSL 顶点扰动 + 纵向渐变） | 低-中（现成方案多） |
| 与 CRT 后处理叠加 | 好（锥体轮廓清晰，扫描线打上去有质感） | 一般（粒子细碎，扫描线/噪点下易显脏） |

**权衡要点**：方案 A 的胜点在 **overdraw 可控**——而这正是半透明实体 + Bloom 方案的命门（`materials-and-lighting.md` §7.2 已把半透明层数上限定为 4 层）。方案 B 的胜点在 **draw call 极低与视觉自然**，但会把 overdraw 推高，可能反过来吃掉省下的性能。

**选择判据（交工程侧对账）**：
- 实测瓶颈在 **fill rate / overdraw** → 选 **A（cone）**
- 实测瓶颈在 **draw call / CPU** → 选 **B（粒子）**

### 3.3 参数映射

以下映射对**两个方案通用**（方案 B 中 `flameLen` 映射到粒子发射初速 × 生命周期）。

| 2D 参数 | 3D 对应 |
|---------|---------|
| flameLen | cone length（A）／粒子初速 × lifetime（B） |
| flameLen/3 | baseRadius ≈ length / 6（锥形更尖，视觉上与 2D 窄条一致） |
| flicker | shader uniform `uFlicker`（A）／发射速率与初速抖动（B） |
| speedFactor | shader uniform `uSpeedFactor` + length 缩放 |
| index × 0.7 | 每艘舰独立的 phase offset，写入 uniform |

**2D 闪烁公式必须 1:1 传承**（`BattleScene.ts` 行 2785-2793）：

```
phase      = time * 0.018 + index * 0.7
flicker    = 0.75 + sin(phase*1.3)*0.20 + sin(phase*2.7)*0.08
pulseX     = 0.85 + sin(phase*1.7)*0.12 + speedFactor*0.08
pulseY     = 0.90 + sin(phase*2.1)*0.08 + speedFactor*0.05
alpha      = flicker * (0.85 + speedFactor*0.15)
```

### 3.4 多引擎布局

- Battleship / Carrier：2-4 个尾焰 cone，位于尾部喷口处。
- Destroyer / Cruiser：1-2 个。
- Fighter：1 个微型 cone。
- 旗舰可额外增加两侧副喷口尾焰。

均值按 **1.5 个/舰** 计（32 舰 → 48 个尾焰），用于 `performance-budget.md` 核算。

### 3.5 性能与 LOD

**方案 A（cone）**：

| LOD | 尾焰处理 |
|-----|----------|
| LOD0 | 完整 cone（64 tris）+ shader 顶点扰动 |
| LOD1 | 静态 cone（32 tris，无顶点扰动），纯色 additive |
| LOD2 | 简化为发光点或关闭 |

**方案 B（粒子）**：

| LOD | 尾焰处理 |
|-----|----------|
| LOD0 | 30 粒/发射器，全尺寸 |
| LOD1 | 15 粒/发射器，尺寸 ×0.8 |
| LOD2 | 关闭（仅保留发光点） |

**共同降级规则**：性能不足时，尾焰是**第一个**被降级的对象（见 `performance-budget.md` §9 降级顺序第 1 步），因为它对战斗判读的影响最小。

## 4. 特效资源池

护盾涟漪、激光束、尾焰 cone/粒子均为高频创建/销毁对象，应使用对象池：

```ts
class EffectPool {
  private shieldArcs: THREE.Mesh[] = [];
  private lasers: THREE.Group[] = [];
  private exhausts: THREE.Mesh[] = [];   // 方案 A
  // private emitters: ParticleEmitter[] = [];  // 方案 B
  // acquire / release
}
```

避免每帧 new 材质/几何。方案 B 需特别注意：粒子池必须预分配固定容量（按 3,000 上限），运行期不得动态扩容。
