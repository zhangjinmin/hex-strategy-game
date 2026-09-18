# 21 · 动作模型（FBX，自带动画）—— 放进文件夹就能看

> 面向作者：**你只管把 `.fbx` 丢进文件夹**，巡览里会多出一个「动作模型 · 带动画」板块，逐个展示、循环播放。
> 不需要登记、不需要改代码、不需要指定动作。

## 1. 怎么用（两步）

1. 把 `.fbx` 复制进 **`frontend/src/assets/anim/`**（一个文件 = 一件展品）。
2. **重启 dev**（`node frontend/_run_wails_dev.cjs`）→ 打开巡览 → 拉到最右侧的「动作模型 · 带动画」板块。

- 展示名 = 文件名（去 `.fbx`）。想要中文名，在 `animModels.ts` 的 `ANIM_CN` 里加一行（例：`walk: '行走动作'`）。
- 朝向不对时，在 `animModels.ts` 的 `ANIM_MODEL_YAW` 里按文件名给一个角度（例：`{ 'walk.fbx': 180 }`）。
- 板块为空时 HUD 会直接把放置路径写在屏幕上。

## 2. 约定与实现

| 项 | 做法 | 为什么 |
|---|---|---|
| 发现文件 | `import.meta.glob('../../assets/anim/*.fbx', { eager, query:'?url' })` | 与 ship/scene 同款；**必须在 `vite.config.ts` 的 `assetsInclude` 里加 `**/*.fbx`**（否则 vite 会当未知类型处理） |
| 加载 | three 自带 `FBXLoader`（`three/examples/jsm/loaders/FBXLoader.js`） | 0.160 自带，二进制 FBX 也能读（fflate 随包） |
| 动作 | **一个 fbx = 一段动作** ⇒ 只取 `root.animations[0]`，`LoopRepeat` 循环播 | 作者就是这么给素材的（`walk.fbx` / `run.fbx` 各 1 段）；不做切换 UI |
| 尺寸 | 按**身高**等比归一化到 `ANIM_SHOW_HEIGHT = 22`（与舰长 `SHIP_LEN = 18` 同量级） | FBX 单位多为 **cm**（实测模型高 169~186），直接用默认 scale 会大得离谱 |
| 贴地 | 归一化后**重算包围盒**、`position.y -= box.min.y` | 不假设原点在脚底（Blender 导出常把原点放在胯部或世界原点） |
| 每帧推进 | `animate()` 里 `for (const a of animGroups.values()) a.mixer.update(dt)` | 每份实例**各自的 mixer** |
| 标签 | DOM 标签显示：`动作 N 段 · 时长 · 骨骼 N` / `tris · 身高` | 一眼核对"读到的动作对不对、尺寸对不对" |

## 3. 三个实测坑（踩过，写下来防复发）

1. **蒙皮网格的包围盒不随骨骼更新** ⇒ three 的视锥剔除会把整个模型剔掉（远处尤其明显）。
   已在加载时对每个网格设 `frustumCulled = false`。
2. ⚠⚠ **同一个 `AnimationClip` 实例被第二个 mixer 绑定时，旋转轨道会失效。**
   实测（`_fbx_bind.cjs`）驱动顺序 vs Hips 局部四元数变化量：
   首绑者 `0.0657` ✓ / 第二个 mixer **`0`** ✗ / 第三个 也 `0` ✗。
   ⇒ 本模块**每个文件只摆一份**（巡览正是如此，未受影响）。
   真要摆多份同型：**把文件复制成两份**（各自独立加载 ⇒ 各自独立 clip），不要共用一份 clip 建两个 mixer。
3. **`SkeletonUtils.clone` 出来的克隆体**在本项目里可用（骨骼安全），**但前提是它的 mixer 是首绑**
   （见坑 2）—— 若同一文件已被别的 mixer 绑过，克隆体的姿态同样不动。

> 想在同一模型上切换多个动作，正规做法是在 Blender 里把多个 Action **一起导出成一个 GLB**（多 clip），
> 那属于 ship/scene 那条 GLB 管线，不在本模块范围。

## 4. 验证

```bash
node frontend/_fbx_gallery.cjs   # 真实入口进巡览 → 12 项断言（含"动画真的在动"）
node frontend/_fbx_bind.cjs      # 定位用：mixer/骨骼绑定诊断（含上面的坑 2 证据）
node frontend/_fbx_anim.cjs      # 素材结构报告（clip 数/时长/骨骼数/单位）
node frontend/_run_vuetsc.cjs    # 类型检查（看 EXIT=0）
```

`_fbx_gallery.cjs` 的 12 项断言：glob 认文件 / 两个 fbx 各恰 1 段 clip / 都进场景 / 贴地 min.y≈0 /
身高=22±5% / 各有 mixer / mixer 互相独立 / 板块标题在 DOM / 标签含"动作 1 段·时长·骨骼" /
**隔 0.6s 该骨骼局部四元数与世界矩阵都变了**（真在动）/ 截图已出 / 页面无异常。

## 5. 边界

- **只在巡览里展示**，不参与战场（战场没有"人物/动作单位"的概念）。
- 动模**不参与点选调姿态**（朝向/竖起/自旋是舰船与建筑的 UI；动模每型只有一段动作，无切换需求）。
  调朝向请用 `ANIM_MODEL_YAW`。
- 一个 fbx 5 万面级别，纯色材质直接沿用 FBX 自带的（未做 CRT 线框处理）。
