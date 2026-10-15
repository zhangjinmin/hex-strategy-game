/**
 * [R7 · 可玩性冲刺] 3D 模式下的「可见层」契约台架 —— 定稿 §3 明列、此前缺失的**最重要防线**。
 *
 * 为什么要它：3D 模式下 `body.battle3d-mode` 把整个 Phaser 画布隐藏 ⇒ 凡是"只画在 Phaser 上、
 * 无 DOM 对应"的 UI（阶段横幅 / 部署倒计时 / 战损角标）都会**一个像素都看不到**。此前没有台架能拦住
 * 「承诺自动开战（R2）/ 横幅被全屏层遮死（R3）」这类**可见层**缺陷 ⇒ 本台架补上。
 *
 * 断言分四组（**每条都配反例行**：改坏后必须 FAIL）：
 *   ① DOM 对应存在性：`showBattleBanner` / `updateDeployText` / `battleLossText` 三者在 DOM 侧都有实现
 *   ② z-index 覆盖关系：DOM 横幅必须高于需要覆盖的层（**捕获 R3**）
 *   ③ 文案一致性：`deployCountdownSec` 的所有渲染出口对"是否自动开战"的表述一致（**捕获 R2**）
 *   ④ `body.battle3d-mode` 的隐藏规则不得命中任何"已 DOM 化"的 UI（**捕获"W1.4 类误判"**）
 *
 * 运行：node --import ./_ts_resolve.mjs scripts/uiVisibilitySim.cjs
 * ⚠ 锚点必须唯一（本项目有过"锚点被注释误匹配"的教训 —— `BattleScene` 里同名字符串可能出现 2 次）。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (p) => fs.readFileSync(p, 'utf8');
const scene = read('./frontend/src/game/scenes/BattleScene.ts');
const store = read('./frontend/src/store/gameStore.ts');
const app = read('./frontend/src/App.vue');
const banner = read('./frontend/src/components/battle/BattleBanner.vue');
const intro = read('./frontend/src/components/battle/BattleIntroOverlay.vue');
const footer = read('./frontend/src/components/battle/GameFooter.vue');

let passed = 0;
let failed = 0;
function check(name, body) {
  try {
    assert.equal(body(), true);
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}: ${error.message}\n`);
  }
}

/** 在 CSS 文本里取 `.<cls> { ... }` 块的 `z-index` 数值。 */
function zIndexOf(css, cls) {
  const at = css.indexOf(`.${cls} {`);
  if (at < 0) throw new Error(`选择器缺失: .${cls}`);
  const end = css.indexOf('}', at);
  const block = css.slice(at, end < 0 ? undefined : end);
  const m = /z-index:\s*(-?\d+)/.exec(block);
  if (!m) throw new Error(`.${cls} 无 z-index`);
  return Number(m[1]);
}

/** 取 `body.battle3d-mode ...` 的所有规则选择器文本（到 `{` 为止）。 */
function battle3dModeSelectors(css) {
  const out = [];
  const re = /body\.battle3d-mode[^{]*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) out.push(m[0].replace(/\{$/, '').trim());
  return out;
}

/** 断言某个字符串在文本中**唯一**出现（防锚点被注释误匹配）。 */
function uniqueCount(text, needle) {
  let n = 0, i = text.indexOf(needle);
  while (i >= 0) { n += 1; i = text.indexOf(needle, i + needle.length); }
  return n;
}

// ════════════════════════════════════════════════════════════════════
// ① DOM 对应存在性（"承诺自动开战"与"横幅被遮"之所以能漏掉，正因缺这层防线）
// ════════════════════════════════════════════════════════════════════
console.log('\n=== ① DOM 侧对应实现存在性 ===');

const bannerHasDom = (b = banner) => b.includes('battle-banner') && b.includes('battleBanner');
const lossHasDom = (b = banner) => b.includes('battle-loss') && b.includes('battleLossText');
const deployFooterHasDom = (f = footer) => f.includes('text-deploy') && f.includes('battleDeployPhase');
const introCountdownHasDom = (i = intro) => i.includes('io-cd') && i.includes('deployCountdownSec');
const sceneWritesStoreBanner = (s = scene) => /this\.store\.showBattleBanner\?\.\(/.test(s);
const storeExposesBanner = (s = store) => s.includes('showBattleBanner') && s.includes('battleLossText');

check('store.showBattleBanner / battleLossText 存在（DOM 可见层数据源）', () => storeExposesBanner());
check('BattleScene.showBattleBanner 写 store（3D 下 Phaser 版不可见 ⇒ 必须镜像 DOM）', () => sceneWritesStoreBanner());
check('BattleBanner.vue 渲染阶段横幅（.battle-banner ← store.battleBanner）', () => bannerHasDom());
check('BattleBanner.vue 渲染战损角标（.battle-loss ← store.battleLossText）', () => lossHasDom());
check('GameFooter.vue 渲染部署期常驻提示（.text-deploy ← battleDeployPhase）', () => deployFooterHasDom());
check('BattleIntroOverlay.vue 渲染部署倒计时（.io-cd ← deployCountdownSec）', () => introCountdownHasDom());

// 反例行（改坏后必须 FAIL）
check('反例：BattleBanner.vue 去掉 .battle-banner 声明 ⇒ 断言 FAIL', () => bannerHasDom(banner.split('battle-banner').join('X')) === false);
check('反例：BattleBanner.vue 去掉 battleLossText 绑定 ⇒ 断言 FAIL', () => lossHasDom(banner.split('battleLossText').join('X')) === false);
check('反例：GameFooter.vue 去掉 .text-deploy ⇒ 断言 FAIL', () => deployFooterHasDom(footer.split('text-deploy').join('X')) === false);
check('反例：BattleIntroOverlay.vue 去掉 deployCountdownSec ⇒ 断言 FAIL', () => introCountdownHasDom(intro.split('deployCountdownSec').join('X')) === false);
check('反例：BattleScene 不再镜像 store 横幅 ⇒ 断言 FAIL', () => sceneWritesStoreBanner(scene.split('this.store.showBattleBanner?.(').join('noop(')) === false);

// ════════════════════════════════════════════════════════════════════
// ② z-index 覆盖关系（捕获 R3：部署期横幅 z40 被全屏层 z60 遮死）
// ════════════════════════════════════════════════════════════════════
console.log('\n=== ② z-index 覆盖关系（R3）===');

const bannerZ = zIndexOf(banner, 'battle-banner');
const introZ = zIndexOf(intro, 'io-overlay');
const lossZ = zIndexOf(banner, 'battle-loss');

const bannerCoversIntro = (b, i) => zIndexOf(b, 'battle-banner') > zIndexOf(i, 'io-overlay');

check(`阶段横幅 z-index(${bannerZ}) > 部署全屏层 .io-overlay z-index(${introZ})（否则部署期横幅被遮死）`, () =>
  bannerCoversIntro(banner, intro));
check(`战损角标 z-index(${lossZ}) > 0（可见；仅战斗期显示，无需盖过部署层）`, () => lossZ > 0);
check('反例：横幅退回 z-index 40（< 部署层 60）⇒ 断言 FAIL', () =>
  bannerCoversIntro(banner.split('z-index: 70;').join('z-index: 40;'), intro) === false);
check('反例：部署层抬到 z-index 80（> 横幅）⇒ 断言 FAIL', () =>
  bannerCoversIntro(banner, intro.split('z-index: 60;').join('z-index: 80;')) === false);

// ════════════════════════════════════════════════════════════════════
// ③ 文案一致性（捕获 R2：可见层仍承诺"自动开战"）
// ════════════════════════════════════════════════════════════════════
console.log('\n=== ③ 部署倒计时文案一致性（R2）===');

/** 取 BattleIntroOverlay 的 cdLine computed 块文本。 */
function introCdBlock(i = intro) {
  const at = i.indexOf('const cdLine = computed<string>(');
  if (at < 0) throw new Error('cdLine 锚点缺失');
  const end = i.indexOf('});', at);
  return i.slice(at, end < 0 ? undefined : end);
}
/** 取 BattleScene.updateDeployText 的 cdLine 相关文本。 */
function sceneDeployTextBlock(s = scene) {
  const at = s.indexOf('private updateDeployText() {');
  if (at < 0) throw new Error('updateDeployText 锚点缺失');
  const end = s.indexOf('private startBattleAfterDeploy()', at);
  return s.slice(at, end < 0 ? undefined : end);
}

const OLD_PROMISE = '秒后自动开战';

/** 任一出出口都不得再承诺"N 秒后自动开战"；渲染倒计时的出口必须出现否定表述。
 *  ⚠ **只在代码块内判**（`introCdBlock` / `sceneDeployTextBlock`）—— 注释里会出现"旧实现渲染 N 秒后自动开战"
 *  这类叙述（本项目"锚点被注释误匹配"教训的同类），整文件 includes 会误判。 */
const cdConsistent = (i = intro, s = scene) => {
  const a = introCdBlock(i);
  const b = sceneDeployTextBlock(s);
  if (a.includes(OLD_PROMISE) || b.includes(OLD_PROMISE)) return false;
  return a.includes('不会自动开战') && b.includes('不自动开战');
};

check('渲染出口代码文案无一再承诺"秒后自动开战"（注释不计）', () =>
  !introCdBlock().includes(OLD_PROMISE) && !sceneDeployTextBlock().includes(OLD_PROMISE) && !footer.includes('自动开战'));
check('BattleIntroOverlay.cdLine 与 Phaser updateDeployText 都表述"不自动开战"', () => cdConsistent());
check('GameFooter 部署期提示含"回车开战"（可见入口）', () => footer.includes('回车开战'));
check('store.deployAutoStart 默认 false（行为的真源与文案一致）', () =>
  /const deployAutoStart = ref<boolean>\(false\)/.test(store));

// 反例行（改坏后必须 FAIL）
check('反例：BattleIntroOverlay.cdLine 退回"N 秒后自动开战" ⇒ 断言 FAIL', () =>
  cdConsistent(intro.split('不会自动开战').join('自动开战'), scene) === false);
check('反例：Phaser updateDeployText 文案退回"秒后自动开战" ⇒ 断言 FAIL', () =>
  cdConsistent(intro, scene.split('到点仅提示，不自动开战').join('秒后自动开战')) === false);
check('反例：deployAutoStart 默认改 true ⇒ 断言 FAIL', () =>
  /const deployAutoStart = ref<boolean>\(false\)/.test(
    store.split('const deployAutoStart = ref<boolean>(false)').join('const deployAutoStart = ref<boolean>(true)')) === false);

// ════════════════════════════════════════════════════════════════════
// ④ body.battle3d-mode 不得命中"已 DOM 化"的 UI（捕获 W1.4 类误判）
// ════════════════════════════════════════════════════════════════════
console.log('\n=== ④ body.battle3d-mode 隐藏规则范围（W1.4 类误判）===');

// 「已 DOM 化」的可见层：它们存在的原因正是"画布被隐藏" ⇒ 绝不能被 battle3d-mode 规则隐藏。
const PROTECTED = [
  '.battle-banner',   // W1.1 阶段横幅
  '.battle-loss',     // W1.2 战损角标
  '.io-overlay',      // G4 战前军议全屏层
  '.ui-footer',       // W4.2 部署期常驻提示
  '.war-room',        // 军议面板
  '.b3d-bb-layer',    // 3D billboard 层（W5.4）
  '.global-toast',
];

const selectors = battle3dModeSelectors(app);
const hiddenBy3d = (sels) => PROTECTED.filter((p) => sels.some((sel) => sel.includes(p)));

check(`App.vue 解析到 body.battle3d-mode 规则（正控制：${selectors.length} 条）`, () => selectors.length > 0);
check('正控制：.fleet-ui-layer 仍被 battle3d-mode 隐藏（2D 跟随层，有 3D 替代 ⇒ 允许）', () =>
  selectors.some((s) => s.includes('.fleet-ui-layer')));
check('已 DOM 化的可见层无一被 body.battle3d-mode 命中', () => hiddenBy3d(selectors).length === 0);
check('反例：新增 body.battle3d-mode .battle-banner{display:none} ⇒ 断言 FAIL', () =>
  hiddenBy3d([...selectors, 'body.battle3d-mode .battle-banner']).includes('.battle-banner'));
check('反例：新增 body.battle3d-mode .b3d-bb-layer{...} ⇒ 断言 FAIL', () =>
  hiddenBy3d([...selectors, 'body.battle3d-mode .b3d-bb-layer']).includes('.b3d-bb-layer'));

// 锚点唯一性自检（本项目教训：同名字符串出现 2 次 ⇒ 切片切错）
console.log('\n=== 锚点唯一性 ===');
check('updateDeployText 锚点唯一', () => uniqueCount(scene, 'private updateDeployText() {') === 1);
check('startBattleAfterDeploy 锚点唯一', () => uniqueCount(scene, 'private startBattleAfterDeploy()') === 1);
check('cdLine 锚点唯一', () => uniqueCount(intro, 'const cdLine = computed<string>(') === 1);
check('.io-overlay 选择器唯一', () => uniqueCount(intro, '.io-overlay {') === 1);
check('.battle-banner 选择器唯一', () => uniqueCount(banner, '.battle-banner {') === 1);

console.log(`\n[uiVisibilitySim] passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exit(1);
}
