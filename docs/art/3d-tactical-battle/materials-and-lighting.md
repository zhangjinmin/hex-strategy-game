# 3D 战术战斗层材质与光照方案

> 修订版 R1 — 已纳入用户决策：CRT 强度可调滑杆（默认 75%）/ 半透明实体 + 线框叠加的技术规格

## 1. 设计目标

- 保留 2D CRT 线框科幻感：扫描线、径向色差、暗角、微噪点、全息绿强调色。
- 在 3D 中增加体积可读性：舰船要有前后、左右、上下可辨的形体。**用户已选定：半透明实体 + 线框叠加**。
- 与战略层 `ThreeStrategicMap.ts` 的后处理管线保持一致，参数针对战术层微调。
- CRT 强度**全局可调**，重度特效敏感用户可归零（见 §6.3 与 `accessibility.md`）。

## 2. 整体材质哲学

战术层不是“真实太空”，而是**全息战术投影台**。因此：

- 不使用 PBR（Metalness/Roughness）。
- 主要使用 `MeshBasicMaterial` 与自定义 `ShaderMaterial`（自发光、透明度、AdditiveBlending）。
- 形体感来自**半透明体积 + 自发光边缘**，而非外部光照。

## 3. 舰船材质（半透明实体 + 线框叠加）

### 3.1 三层结构

完整规格见 `ship-assets.md` §2.2。此处只列与渲染直接相关的参数：

| 层级 | 颜色 | 不透明度 | 混合 | depthWrite | depthTest | renderOrder | side |
|------|------|----------|------|------------|-----------|-------------|------|
| ① 实体层 | 阵营色 **× 0.35** | **0.55**（R1 上调，见 §3.4） | Normal | **false** | true | **10** | FrontSide |
| ② 线框层 | 阵营色 **× 1.0** | **0.90** | Normal | **false** | true | **11** | FrontSide |
| ③ 发光部件 | `0xffcc66` / `0xffffff` | 0.6 - 0.9 | **Additive** | **false** | true | **12** | FrontSide |

> **R1 变更**：实体层 opacity 由 R0 的 `0.18-0.28` 上调至 **0.55**，线框层由 `0.80-0.95` 收敛为 **0.90**。依据 UX 侧 `05-readability-risks.md` R-03（S 级）：低于 0.55 时，多艘半透明舰船屏幕重叠会颜色累加趋近灰白、阵营色失效。

### 3.2 为什么实体层亮度要压到 0.35

UnrealBloomPass 按亮度阈值提取高光。阵营色 `0x2dd4bf` 的感知亮度约 **0.69**：

| 层 | 输出亮度 | Bloom 阈值 0.62 | 结果 |
|----|----------|-----------------|------|
| 实体层（×0.35） | **0.24** | 低于阈值 | **不产生 Bloom** — 体积存在但不发光糊 |
| 线框层（×1.0） | **0.69** | 略高于阈值 | 产生轻微边缘辉光 — 这是想要的 |

若实体层直接用满亮度阵营色，密集舰队重叠时每层都过阈值，Bloom 会把整片舰队糊成光团（即 R0 风险清单里的“Bloom 过曝”）。**0.35 系数是这道风险的直接缓解手段**。`[PLACEHOLDER · 附验证路径]`

### 3.3 材质实例

```ts
// 同盟实体层（R1：opacity 0.22 → 0.55）
const allianceSolid = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0x2dd4bf).multiplyScalar(0.35),
  transparent: true, opacity: 0.55,
  depthWrite: false, depthTest: true, side: THREE.FrontSide,
});
// 同盟线框层
const allianceWire = new THREE.MeshBasicMaterial({
  color: 0x2dd4bf, wireframe: true,
  transparent: true, opacity: 0.90,
  depthWrite: false, depthTest: true, side: THREE.FrontSide,
});
```

材质按 `(faction, layer, lod)` 缓存，不 per-instance 创建。

### 3.4 实体层 alpha 与「特效强度」滑杆的耦合（R1 新增）

UX 侧（`06` §2.1、R-03）要求：「主控特效滑杆 = 0 时，舰船自动切换为 `alpha = 1.0` 的不透明实体」——这是「归零后仍完全可玩」的验收硬项。**采纳。**

但直接把 alpha 提到 1.0 会暴露一个 R0 遗留问题：实体层亮度被压到 ×0.35 是为了规避 Bloom，若不透明化而亮度不变，舰船会变成**实心暗块**（亮度 0.24）沉入 `0x02040a` 的暗背景，反而更不可读。因此 alpha 与亮度必须**联动**：

| 特效强度 | 实体层 alpha | 实体层亮度系数 | Bloom | 理由 |
|:--------:|:------------:|:--------------:|:-----:|------|
| 100% | 0.55 | × 0.35 | 开 | 全息观感优先 |
| **70%（默认）** | **0.55** | **× 0.35** | **开** | 默认档 |
| 50% | 0.70 | × 0.55 | 开（弱） | 开始向可读性倾斜 |
| 30% | 0.85 | × 0.80 | 关 | 亮度回升，靠 alpha 保体积 |
| **0%** | **1.00** | **× 1.00** | **关** | **不透明实体 + 满亮度阵营色 → 完全可玩** |

**为什么 0% 档必须同时关 Bloom**：满亮度阵营色亮度 0.69 > Bloom 阈值 0.62，若 Bloom 仍开会产生辉光。但 0% 档本来就是「后处理链 bypass」（UX 侧同表已将 Bloom 置 0），两者一致，无额外冲突。

**注意**：0% 档下线框层依然绘制（opacity 0.90），叠在不透明实体之上，视觉上仍有 CRT 轮廓感——**归零不等于风格消失，只是后处理消失**。

**alpha 从 0.22 提到 0.55 后，Bloom 安全性复核（重要）**：

R0 定 ×0.35 亮度系数时是按 alpha 0.22 算的。alpha 提高后需复核是否仍低于 Bloom 阈值 0.62：

| 叠加舰船数 | 有效覆盖率 `1−(1−α)ⁿ` | 合成亮度 `0.24 × 覆盖率` | vs 阈值 0.62 |
|:----------:|:----------------------:|:------------------------:|:------------:|
| 1 | 0.550 | **0.132** | 安全（余量 4.7×） |
| 2 | 0.798 | **0.192** | 安全 |
| 3 | 0.909 | **0.218** | 安全 |
| 4 | 0.959 | **0.230** | 安全 |

**结论：alpha 0.55 不会触发 Bloom，×0.35 亮度系数继续有效，§7.3 的缓解方案 ①② 无需调整。** 这正是当初把亮度压制放在「颜色」而非「opacity」上的收益——两者解耦后，调 alpha 不影响 Bloom 行为。

## 4. 棋盘/地形材质

| 层级 | 材质 | 参数 |
|------|------|------|
| 顶面/侧面填充 | `MeshBasicMaterial` | color = `0x00cc66` / 阵营色 / 地形色，transparent，opacity = 0.04-0.16，depthWrite = false |
| 棱柱边线 | `LineSegments` / `EdgesGeometry` | color 同上，opacity = 0.25-0.55 |
| 顶面高亮 | `LineBasicMaterial` | color 同上，opacity = 0.7-0.85（模拟扫描高光带） |

**棋盘棱柱同样适用底面免建模**：底部封口面永不朝上可见，可省略。六边形棱柱由 24 tris（含底盖）降为 **18 tris**（顶盖 6 + 侧面 12）。

地形符号（Planet / Fortress / Sea / Castle 等）沿用 2D 语义，Additive 混合，颜色与 2D 版本一致。

## 5. 光照

由于大量使用 `MeshBasicMaterial`，光照不是主要造型手段，仅需少量光源给非自发光元素分层：

| 光源 | 类型 | 参数 | 作用 |
|------|------|------|------|
| 主光 | `DirectionalLight` | `0xffffff`, intensity 0.6, position (10, 20, 10) | 给实体层轻微明暗，增强立体感 |
| 补光 | `AmbientLight` | `0x040810`, intensity 0.25 | 避免纯黑死区 |

若性能吃紧，可完全移除实时光照，改用 ShaderMaterial 内 baked 法线伪光照。`[PLACEHOLDER · 附验证路径]`

## 6. 后处理管线

```ts
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(w * 0.5, h * 0.5),
  0.38,   // strength（随 CRT 强度联动，见 §6.3）
  0.4,    // radius
  0.62,   // threshold（R0: 0.52 → R1 提高，缓解半透明过曝）
);
composer.addPass(bloomPass);

const crtPass = new ShaderPass({ /* 见 §6.2 */ });
composer.addPass(crtPass);
```

### 6.1 Bloom 参数

| 参数 | 战略层 | R0 战术层 | **R1 修订** | 理由 |
|------|--------|-----------|-------------|------|
| strength | 0.38 | 0.35-0.42 | **0.35 - 0.42（随 CRT 强度联动）** | 见 §6.3 联动表 |
| radius | 0.4 | 0.35-0.45 | **0.4** | 与战略层对齐，减少调参面 |
| threshold | 0.52 | 0.50-0.58 | **0.62** | **关键改动**：半透明实体叠加后整体亮度抬高，必须提高阈值，只让线框/激光/引擎/护盾过阈 |

### 6.2 CRT ShaderPass

在战略层色差 + 暗角基础上，战术层增加扫描线与微噪点。**四个参数全部由 `crtIntensity` 驱动**：

```glsl
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
uniform float uScanlineAmp;   // 扫描线振幅
uniform float uCaStrength;    // 色差系数
uniform float uVigFloor;      // 暗角下限
uniform float uNoiseAmp;      // 噪点振幅
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec2 center = uv - 0.5;
  float dist = length(center);
  vec2 dir = center / max(dist, 0.001);

  // 径向色差
  float ca = dist * uCaStrength;
  vec3 col;
  col.r = texture2D(tDiffuse, uv - dir * ca).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv + dir * ca).b;

  // 暗角
  float vig = smoothstep(0.9, 0.3, dist * 1.4);
  col *= mix(uVigFloor, 1.0, vig);

  // 扫描线
  float scanline = sin(uv.y * uResolution.y * 1.5 + uTime * 0.5) * 0.5 + 0.5;
  col *= mix(1.0 - uScanlineAmp, 1.0, scanline);

  // 微噪点
  float noise = fract(sin(dot(uv * uTime, vec2(12.9898, 78.233))) * 43758.5453);
  col *= mix(1.0 - uNoiseAmp, 1.0, noise);

  gl_FragColor = vec4(col, 1.0);
}
```

### 6.3 CRT 强度滑杆规格（用户决策派生）

#### 档位设计

| 项 | 规格 | 理由 |
|----|------|------|
| 类型 | **连续滑杆**，`min=0` `max=100` `step=5` | 项目已有 `musicVolume`（连续）与 `uiScale`（step 5）两种先例；CRT 是主观偏好，分档会让用户在两档之间找不到满意点。step=5 给出 21 个可选位，足够细腻又不难拖 |
| 默认值 | **75** | 落在用户指定的 70-80% 区间中点；对应“能看出 CRT 但不干扰 3D 判读” |
| 建议值 | 战术判读为主 → 50-65<br>氛围为主 → 80-100<br>特效敏感 → 0-30 | — |
| 性能影响 | 无（只改 uniform，不触发 shader 重编译，不增加 pass） | 可放心做成实时滑杆 |

#### 四参数联动表（核心）

设 `s = crtIntensity / 100`：

| 参数 | 公式 | 0% | 25% | **50%** | **75%（默认）** | 100% |
|------|------|-----|-----|---------|----------------|------|
| 扫描线振幅 `uScanlineAmp` | `0.08 × s` | 0.000 | 0.020 | 0.040 | **0.060** | 0.080 |
| 色差系数 `uCaStrength` | `0.004 × clamp((s−0.30)/0.70, 0, 1)` | **0.0000** | **0.0000** | 0.0011 | **0.0026** | 0.0040 |
| 暗角下限 `uVigFloor` | `1.0 − 0.28 × s` | 1.00 | 0.93 | 0.86 | **0.79** | 0.72 |
| 噪点振幅 `uNoiseAmp` | `0.04 × s^1.5` | 0.000 | 0.0100 | 0.0141 | **0.0260** | 0.040 |
| *（联动）* Bloom strength | `0.42 − 0.07 × s` | 0.420 | 0.4025 | 0.385 | **0.3675** | 0.350 |

**设计说明**：

- **100% 档 = 2D CRT 等价**：`uScanlineAmp = 0.08` 对齐 2D 的 `CRT_SCANLINE_ALPHA`；`uCaStrength = 0.004` 与 `uVigFloor = 0.72` 与战略层 `ThreeStrategicMap.ts` 现行值完全一致。
- **0% 档 = 纯净 3D**：四个参数全部归零，只剩 Bloom。满足重度特效敏感用户（见 `accessibility.md`）。
- **噪点用 `s^1.5` 而非线性**：噪点在半透明实体上会被 Bloom 放大成“脏点”，低强度区压得更狠。
- **Bloom 反向联动（可选，但建议做）**：CRT  haze 越高，Bloom 应越收，否则两者叠加会糊。这是缓解“半透明 × CRT 过曝”的第二道保险。
- **色差改为「延迟启动」曲线（R1，采纳 UX 侧）**：R0 的线性 `0.004 × s` 改为 `0.004 × clamp((s−30%)/70%, 0, 1)`。**s ≤ 30% 时色差恒为 0**。

#### 为什么色差要优先归零（采纳 UX 侧 R-08）

UX 侧给出了一组明确的损害优先级，本侧认同并完全采纳：

> **色差 > 扫描线 > 噪点 > 暗角**（对可读性的损害从大到小）

- **色差**是径向 RGB 分离，直接把 1px 细线框和小字糊成彩边重影——而线框正是本方案的敌我识别主载体，损害最大，必须最先归零。
- **扫描线**降低有效分辨率，但只影响水平方向，线框仍可辨，次之。
- **噪点**在半透明实体上被 Bloom 放大显脏，但幅度小（≤0.04），再次之。
- **暗角**只压暗画面边缘、不改变中心清晰度，且提供构图收束作用，损害最小，应最后归零。

**副作用（正面）**：默认档 75% 的色差从 R0 的 0.0030 降为 **0.0026**，默认观感比 R0 更锐利，恰好缓解 UX 侧 R-08 的担忧，且不影响 100% 档与 2D 等价。

> ⚠️ **与 UX 侧 `06` §2.1 的一处分歧（待 team-lead 裁决）**：UX 侧把 CRT 设为「特效强度」主控滑块的子项（`CRT = master × 0.8`），即**没有独立的 CRT 滑块**。但用户的决策原文是「CRT 强度：**可调滑杆**，范围 0-100%，默认 70-80%」。若 CRT 只是主控的衍生值，则它无法独立调到 100%，也失去了用户明确要求的独立滑块。**本侧主张保留独立 CRT 滑块（默认 75），同时采纳 UX 侧的优先级排序**（上表已按此实现）。详见 §6.4。

#### settingsStore 改动

沿用 `starmapDisplayMode` 的完整先例，在 `frontend/src/store/settingsStore.ts` 中：

```ts
// ===== 3D 战术战斗 CRT 强度 =====
// 0 = 纯净 3D 画面；100 = 完整复古 CRT（扫描线/色差/暗角/噪点全开）
const crtIntensity = ref(75);
```

以下五处必须同步修改（对照 `starmapDisplayMode` 的现有写法，缺一会导致设置不持久化）：

| 位置 | 改动 |
|------|------|
| `load()` | `crtIntensity.value = data.crtIntensity ?? 75;` |
| `save()` | JSON 中加 `crtIntensity: crtIntensity.value` |
| `watch([...])` 依赖数组 | 加入 `crtIntensity` |
| `resetDefaults()` | `crtIntensity.value = 75;` |
| `return { ... }` | 导出 `crtIntensity` |

#### SettingsPanel 摆放与文案

**位置建议**：放进现有「**战场显示**」section，紧跟「默认战场模式」的双按钮组之后。

理由：CRT 强度是战场呈现参数，与同 section 的 `battlefieldMode` 语义相邻；玩家会自然地在调战场模式时一并调 CRT。不建议新开 section（现有 2 列网格已有 6 个 section，再加会让面板过长）。

```vue
<!-- 战场显示 section 内，mode-switch-group 之后 -->
<div class="setting-row">
  <span class="setting-label">CRT 强度</span>
  <input type="range" min="0" max="100" step="5"
         v-model.number="settings.crtIntensity" class="setting-slider" />
  <span class="setting-value">{{ settings.crtIntensity }}%</span>
</div>
<div class="setting-hint">调节全息战术投影的扫描线 / 色差 / 暗角 / 噪点强度。0% 为纯净 3D 画面，100% 为完整复古 CRT 风格。默认 75%。</div>
```

复用现有 `.setting-slider` / `.setting-label` / `.setting-value` / `.setting-hint` 类，无需新增样式。

**辅助功能面板**另需一个一键入口，见 `accessibility.md` §3。

### 6.4 滑块架构：保留独立 CRT 滑块（R1-C：分歧已收敛）

**UX 侧已采纳本侧意见，改为双滑块模型 + 主控作为预设驱动器。** 本节的争议部分仅作历史记录保留。

| | ~~UX 侧原方案：单主控~~ | **最终：双独立滑块** |
|---|------------------------|---------------------|
| 控件 | 「特效强度」一个 | 「特效强度」+「CRT 强度」两个 |
| CRT 可调范围 | ~~0 - 80%~~ | **0 - 100%** |
| CRT 能否独立调整 | ~~否~~ | **是** |
| 默认值 | ~~主控 70 → CRT 70~~ | 主控 70，**CRT 75** |
| 主控角色 | 强制耦合 | **预设驱动器**（拖动时同时设两滑杆推荐值，玩家仍可单独微调） |

**采纳理由**（UX 侧确认）：
1. 用户决策原文是「CRT 强度：**可调滑杆**，范围 0-100%，默认 70-80%」。做成主控衍生量后玩家无法单独调到 100%，等于用户点名的那个滑块不存在。
2. 「特效强度」（玩法反馈：激光/护盾/尾焰/爆炸）与「CRT 强度」（呈现风格：扫描线/色差/暗角/噪点）语义不同，存在「满特效 + 无 CRT」与「强 CRT + 温和特效」两种合法需求，单主控无法同时满足。

**同时采纳 UX 侧的核心洞察**：低强度按损害优先级依次归零（**色差 → 噪点 → 扫描线 → 暗角**），已在独立 CRT 滑块**内部**实现（§6.3 的色差延迟启动曲线）——不需要通过主控耦合也能达到同样效果。

#### ⚠️ 附加硬要求：「全部归零」一键按钮

UX 侧在采纳独立滑块后提出，本侧完全同意并已补上完整规格（见 `accessibility.md` §3.5）：

> **这不是便利功能，是可访问性验收硬项。** 「归零后仍完全可玩」不能要求重度敏感用户逐个滑块拖一遍。

一次性把**特效主控、CRT、Bloom、色差、粒子**全部置 0，并同步把舰船实体层切到 `alpha = 1.0` + `亮度 ×1.0`（**两者必须同时改**，否则不透明舰船会变成沉入 `0x02040a` 的实心暗块，比半透明更不可读）。**全档位可见**，非 Comprehensive 专属。

## 7. 半透明技术难点规格（用户决策派生）

半透明实体 + 线框叠加是 R0 风险清单里“Bloom 过曝”与“线框混叠”的放大器。以下为可直接落地的参数。

### 7.1 透明排序方案

**核心原则**：所有 `transparent: true` 的材质一律 `depthWrite = false`，并**显式指定 renderOrder**，不依赖 Three.js 的自动距离排序。

| 对象 | transparent | depthWrite | depthTest | blending | **renderOrder** | side |
|------|-------------|------------|-----------|----------|-----------------|------|
| 棋盘底板（不透明） | false | true | true | Normal | 0 | FrontSide |
| 棋盘棱柱填充 | true | **false** | true | Normal | 1 | FrontSide |
| 棋盘边线 | true | **false** | true | Normal | 2 | FrontSide |
| 地形符号 | true | **false** | true | Additive | 3 | FrontSide |
| **舰船实体层** | true | **false** | true | Normal | **10** | FrontSide |
| **舰船线框层** | true | **false** | true | Normal | **11** | FrontSide |
| 舰船发光部件 | true | **false** | true | Additive | **12** | FrontSide |
| 护盾涟漪 | true | **false** | true | Additive | 20 | **DoubleSide** |
| 激光束 | true | **false** | true | Additive | 21 | **DoubleSide** |
| 尾焰 cone | true | **false** | true | Additive | 22 | **DoubleSide** |
| 命中光晕 | true | **false** | true | Additive | 23 | FrontSide |
| HUD / 角标 | true | **false** | **false** | Normal | 30 | FrontSide |

**四条硬规则**：

1. **`depthWrite` 必须关**。半透明物体写深度会裁掉其后方本应可见的物体，是半透明场景最经典的翻车点。
2. **`depthTest` 必须开**（HUD 除外）。否则半透明舰船会穿透不透明的棋盘底板。
3. **同一艘舰的三层 renderOrder 必须连续且线框在后**。若线框层 renderOrder ≤ 实体层，线框会被实体层覆盖吞掉，直接破坏“线框叠加”这条决策。
4. **renderOrder 常量集中定义**（建议 `ShipRenderOrder.ts`），不要散落在各处，否则后续加特效会打乱层级。

**关于 InstancedMesh 与排序的取舍**（必须知悉）：

`InstancedMesh` 整体作为一个 object 参与排序，**instance 之间无法再排序**。半透明场景下这会导致 instance 间前后关系错误。建议策略：

| 对象 | 是否 instancing | 理由 |
|------|-----------------|------|
| 常规舰实体层 | ✅ InstancedMesh | opacity 仅 0.22，排序错误几乎不可见 |
| 常规舰线框层 | ✅ InstancedMesh | 同上，且线框本身是叠加装饰 |
| 常规舰发光部件 | ✅ InstancedMesh | Additive 混合本身与顺序无关（加法交换律），**天然免疫排序问题** |
| **旗舰（全部三层）** | ❌ 独立 Mesh | 数量少（≤8），玩家视线焦点，必须精确排序 |
| 特效 | ❌ 独立 Mesh | 数量少、生命周期短，用对象池 |

**结论**：把所有 Additive 的东西尽量 instancing（加法交换律使其免疫排序），把 Normal 混合且视觉权重高的（旗舰）单独渲染。

### 7.2 Overdraw 控制

半透明叠加的代价是同一像素被多次着色。控制目标：

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 同屏单像素**平均** overdraw | **≤ 3.0×** | `[PLACEHOLDER · 附验证路径]` |
| 同屏单像素**峰值** overdraw | **≤ 5.0×** | 密集舰队重叠时的极端值 |
| 允许的半透明层数上限 | **4 层** | 棋盘填充 / 舰船实体 / 舰船线框 / 特效 |

**超限时按以下顺序降级**：

1. 远处舰船降 LOD（LOD1 实体层 opacity 降到 0.15，LOD2 直接关闭实体层只留 billboard）。
2. 实体层 opacity 随重叠密度动态衰减：`opacity = base × (1 − 0.5 × overlapFactor)` `[PLACEHOLDER]`。
3. 棋盘填充在舰船密集区降 alpha（按屏幕空间密度图调整）`[PLACEHOLDER]`。
4. 关闭发光部件层（保留实体 + 线框）。

### 7.3 半透明 × CRT 后处理冲突与缓解

**问题**：半透明实体叠加后，同一像素的累积亮度显著高于纯线框；再经 Bloom 阈值提取，过曝区域会连成片状，即 R0 风险“Bloom 过曝”被放大。

**缓解方案（按优先级）**：

| # | 方案 | 具体做法 | 成本 | 建议 |
|---|------|----------|------|------|
| 1 | **实体层亮度压制** | 实体层颜色 = 阵营色 × **0.35**（见 §3.2） | 0 | **必做** |
| 2 | **提高 Bloom 阈值** | threshold `0.52` → **0.62** | 0 | **必做** |
| 3 | **Bloom 与 CRT 强度反向联动** | `strength = 0.42 − 0.07 × s`（见 §6.3 表） | 0 | **建议做** |
| 4 | **tone mapping 兜底** | 渲染器启用 `ACESFilmicToneMapping`，`toneMappingExposure ≈ 1.0`，压住最亮的高光尾巴 | 低（仅 renderer 配置） | **建议做** |
| 5 | **选择性 Bloom**（Selective / Layered Bloom） | 用 layer mask 只把“特效层 + 线框层”渲进 bloom target，实体层完全不进 bloom | **高**：+1 render target，+2 pass，约 +30% 后处理开销 | 可选增强，仅在 1-4 仍不满足时采用 |

**注意**：方案 1-3 都是零成本参数调整，应优先做满再考虑方案 5。方案 5 是唯一能根治的手段，但会吃掉 `performance-budget.md` 里的后处理预算，需与工程侧对账后决定。

### 7.4 线框混叠（Wireframe Aliasing）缓解

半透明实体叠加后，背后的线框摩尔纹会更明显（R0 风险“线框混叠”）。

| 手段 | 做法 | 成本 |
|------|------|------|
| MSAA | `WebGLRenderer({ antialias: true })`，或 EffectComposer 使用 `WebGLRenderTarget({ samples: 4 })` | 中 |
| 线框亮度收敛 | 线框 opacity 上限压到 **0.90**（R0 为 0.95），减少高对比摩尔纹 | 0 |
~~| 远处线框淡出 | 距离 > 15 世界单位时，线框 opacity 按距离线性衰减到 0.5 | 0 |~~

**R1 修订：撤回「远处线框淡出」这一条。** 它与 UX 侧 `05-readability-risks.md` **R-17**（A 级必解）直接冲突——R-17 要求「舰体边缘光强度**不随距离衰减**（衰减下限 0.6），保证远处舰船仍有可辨轮廓」，理由是本方案背景极暗（`0x02040a`），远处舰船若同时降低线框强度就会沉入背景。R-17 还特别指出「**不要依赖 Bloom 提高可辨度**——Bloom 会在特效归零时消失」，这与本侧 §3.4 的 0% 档设计一致。

**替代方案：保强度、降密度。** 远处线框的摩尔纹来自**线条密度**而非线条亮度，因此：

| 手段 | 做法 | 成本 | 状态 |
|------|------|------|------|
| MSAA | `WebGLRenderer({ antialias: true })`，或 EffectComposer 使用 `WebGLRenderTarget({ samples: 4 })` | 中 | 保留 |
| 线框亮度收敛 | 线框 opacity 收敛为 **0.90**（R0 为 0.95），减少高对比摩尔纹 | 0 | 保留 |
| **远处线框降密度**（替代淡出） | 距离 > 15 世界单位切 LOD1：用**简化几何**的线框（体块数 3-5 个 → 线数减少约 60%），但**每条线的 opacity 保持 0.90 不变** | 0 | **R1 新增** |
| LOD2 | billboard / 6-8 面图标，线框整体消失，由 §8 的编队标记接管识别 | 0 | 保留 |

**判据**：远处舰船的**线数变少但每条线依然清晰**，而非线数不变但整体变淡。前者消除摩尔纹且保住可辨度，后者两头不讨好。

## 8. 接地投影规格（R1 新增，配合 UX 侧 R-02 / R-09 / R-17）

UX 侧确认：**接地投影是 3D 下唯一的深度锚点**，是 R-02（深度误判，S 级）、R-09（低仰角投影与舰体重叠，A 级）、R-17（暗背景低对比，A 级）三条风险的共同解法底座。本侧完全接受该定位，并给出落地参数。

### 8.1 几何与材质

| 项 | 规格 |
|----|------|
| 几何 | 贴地椭圆（圆盘），位于棋盘平面 **y = 0**，半径 0.40-0.60 世界单位（按舰种，见 `ship-assets.md` §5.0） |
| 朝向 | 长轴沿舰队朝向（`facingAngle`），提供 R-10 要求的朝向表达底座 |
| 材质 | `MeshBasicMaterial`，`transparent: true`，`depthWrite: false`，`depthTest: true`，`side: DoubleSide` |
| **颜色** | 阵营色满亮度（同盟 `0x2dd4bf` / 帝国 `0xc084fc`），**不乘 0.35**——投影是信息层，需要在暗背景上形成亮区 |
| **不透明度** | 轮廓 **0.85** + 填充 **0.25**（见 §8.2） |
| `renderOrder` | **5**（棋盘填充 1 之上、棋盘边线 2 之上，但远低于舰船 10，保证舰船始终压在投影之上） |

### 8.2 关于「alpha ≥ 0.8」的实现方式（部分采纳 UX 侧）

UX 侧要求投影 `alpha ≥ 0.8`。**直接采用 0.8 的实心填充会产生两个问题**：
1. 在 CRT 全息风格下，一块 0.8 不透明度的**亮色实心圆盘**会变成发光板，视觉权重超过舰体本身，喧宾夺主。
2. 实心亮盘在 Bloom 阈值 0.62 附近（阵营色亮度 0.69 × 0.8 ≈ 0.55，接近阈值），密集时会贡献不必要的辉光。

**本侧方案：轮廓 0.85 + 填充 0.25**。总视觉权重与「实心 0.8」相当（轮廓提供边界清晰度，填充提供暗底衬托），但：
- 轮廓清晰 → 满足 R-02 的「投影落在哪个格子」判读需求；
- 填充克制 → 满足 R-17 的「提供暗底衬托」但不喧宾夺主；
- 填充 0.25 的亮度 0.69 × 0.25 = 0.17，**远离 Bloom 阈值**，不会加剧 R-03。

若 UX 侧实测后认为填充不足，可上调至 0.40（亮度 0.28，仍安全），**但不建议超过 0.40**。

### 8.3 z-fighting 的正确解法（**驳回「抬升 2 单位」**）

UX 侧 R-09 提出「抬升投影至平面上方 2 单位」以避免与棋盘平面 z-fighting。**本侧驳回几何抬升，改用 `polygonOffset`**：

| 方案 | 问题 |
|------|------|
| ❌ 几何抬升 2 单位 | 按 `ship-assets.md` §5.0 换算，2 单位 = **30 px**，高于旗舰悬空高度 26 px（1.73 单位）——投影会浮到舰船**上方**，彻底破坏深度锚点语义。即便改成 0.02 单位，也是用一个「魔法偏移量」掩盖问题，不同缩放下表现不一致 |
| ✅ **`polygonOffset`** | 专为共面贴花设计，**与单位无关、与距离无关**，GPU 在深度测试阶段直接偏移，投影视觉上严丝合缝贴在棋盘平面上 |

```ts
const groundProjMat = new THREE.MeshBasicMaterial({
  color: 0x2dd4bf,              // 阵营色，满亮度
  transparent: true, opacity: 0.25,
  depthWrite: false, depthTest: true,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,      // 向相机方向偏移，避免与棋盘平面 z-fighting
  polygonOffsetUnits: -2,
});
```

**同一手法也适用于 UX 侧 R-15**（网格线与棋盘平面的 z-fighting）：网格线同样用 `polygonOffset`，不需要「0.5 单位垂直偏移」。

### 8.4 豁免条款（采纳 UX 侧）

**接地投影的不透明度不随「特效强度」滑杆归零。** 它是深度锚点而非特效，归零会让 3D 彻底丧失深度可读性——这与 UX 侧「归零后仍完全可玩」的验收项直接冲突。

| 特效强度 | 投影轮廓 alpha | 投影填充 alpha |
|:--------:|:--------------:|:--------------:|
| 100% | 0.85 | 0.25 |
| 70%（默认） | 0.85 | 0.25 |
| 30% | 0.90 | 0.30 |
| **0%** | **0.95** | **0.35** |

即：**特效越低，投影反而越强**——因为此时舰船变为不透明实体（§3.4），更需要投影来维持深度线索。这条与 UX 侧 R-17 的精神一致。

### 8.5 垂线（配合 UX 侧 R-02 第 2 条）

舰体中心到接地投影之间画一条细垂线，仰角越低线越长，本身就是深度线索。

| 项 | 规格 |
|----|------|
| 几何 | `LineSegments`，从 `(x, hover − halfHeight, z)` 到 `(x, 0, z)` |
| 材质 | `LineBasicMaterial`，阵营色，opacity **0.35**，`depthTest: true`，`depthWrite: false` |
| `renderOrder` | 6（投影之上、舰船之下） |
| 成本 | 1 draw call（全部垂线合并为一个 `LineSegments`），2 verts/舰 ≈ 可忽略 |

## 9. 深度与排序速查

- 所有透明/发光材质 `depthWrite: false`。
- **修订后的 renderOrder 分层**：棋盘底板 0 / 棋盘填充 1 / 棋盘边线 2 / 地形符号 3 / **接地投影 5** / **垂线 6** / 舰船实体 10 / 舰船线框 11 / 发光部件 12 / 护盾 20 / 激光 21 / 尾焰 22 / 命中光晕 23 / HUD 30 / **编队标记 31**。
- 接地投影与垂线位于舰船**之下**，保证舰船始终压在自己的投影之上（否则会产生「舰船陷进地里」的错觉）。
- 激光束 `renderOrder: 21`，确保覆盖舰船。
- 底面封口面（见 `ship-assets.md` §3）用 `FrontSide`，不参与 DoubleSide 渲染。

## 10. 与 2D CRT 的对应关系

| 2D CRT 元素 | 3D 对应 | 保留策略 |
|-------------|---------|----------|
| `CRT_BG #040810` | scene.background / clearColor | 保留 |
| `CRT_GRID_COLOR 0x1a3a1a` | 棋盘线框 | 保留 |
| `CRT_ACCENT 0x00cc66` | 全息 UI / 棋盘高亮 | 保留 |
| `CRT_SCAN_COLOR 0x00ff88` | 护盾/扫描环/激光 | 保留 |
| 扫描线 alpha 0.08 | CRT ShaderPass 扫描线（100% 档等价） | 保留，**可调 0-100%** |
| 全息棱柱高度分层 | 3D 棱柱 BoxGeometry 高度 | 保留并扩展（底面免建模） |
| 4 角 L 形定位记号 | 3D Line HUD | 保留 |
| 顶部水平刻度 | 3D Line HUD | 保留 |
| （无对应）径向色差 | 战略层已有，战术层沿用 | 新增，**可调** |
| （无对应）暗角 | 战略层已有，战术层沿用 | 新增，**可调** |
| （无对应）微噪点 | 战术层新增 | 新增，**可调** |
