# Tactical Combat Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered battle movement and supply overrides with one testable combat-control core that makes contact, disengagement, turning, reformation, supply, and tactical intent consistent.

**Architecture:** Add pure modules for contact tracking, maneuver phases, supply orders, and task scoring. `BattleScene` converts its live fleets into snapshots, asks the modules for a decision, then applies only the resulting target, heading policy, and unit-slot assignments. Rendering remains Phaser-owned and never makes strategic decisions.

**Tech Stack:** TypeScript, Phaser 4, Node 22 source-level simulation scripts, Vue/Vite type checking.

---

### Task 1: Add deterministic contact and maneuver control

**Files:**
- Create: `frontend/src/game/combatControl.ts`
- Create: `_v48_combat_control_sim.cjs`

- [ ] **Step 1: Write failing contact-lock and maneuver-phase tests**

```js
const C = require('./frontend/src/game/combatControl.ts');
check('pursuer keeps a withdrawing fleet in contact lock',
  C.updateContact({ inContact: true, recentlyHit: true, secondsSinceContact: 0 }, true, 0.25).engaged);
check('engaged fleet withdraws backwards before it may turn',
  C.nextManeuver({ phase: 'cruise', engaged: true, retreatRequested: true, headingError: Math.PI }).phase === 'disengage');
check('a free 180 turn brakes, turns, reforms, then cruises',
  phases.join(',') === 'brake,turn,reform,cruise');
```

- [ ] **Step 2: Run the source-level test and observe failure**

Run: `node --import ./_ts_resolve.mjs _v48_combat_control_sim.cjs`

Expected: failure because `combatControl.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure control API**

```ts
export type ManeuverPhase = 'cruise' | 'brake' | 'turn' | 'reform' | 'disengage';
export function updateContact(previous: ContactState, inRange: boolean, dt: number): ContactState;
export function nextManeuver(input: ManeuverInput): ManeuverOrder;
export function advanceManeuver(state: ManeuverState, input: ManeuverInput, dt: number): ManeuverState;
```

Use contact hysteresis and a time-since-contact release delay. `disengage` must remain active whenever contact is live, keep the threat-facing heading, and return a reverse-motion directive. A large free-space turn must pass sequentially through brake, turn, reform, and cruise.

- [ ] **Step 4: Run the control simulation**

Run: `node --import ./_ts_resolve.mjs _v48_combat_control_sim.cjs`

Expected: all assertions pass.

### Task 2: Make supply a recommendation, not a direct heading override

**Files:**
- Modify: `frontend/src/game/combatDoctrine.ts`
- Modify: `_v48_combat_control_sim.cjs`

- [ ] **Step 1: Add failing supply tests**

```js
check('yellow supply in a live battle holds instead of ordering return',
  C.supplyDecision({ supplyPct: 55, inSupplyChain: false, supplyShipInbound: false,
    supplyShipNear: false, enemyTurningAway: false, ourAdvantage: false,
    aggression: 0.1, holdingGround: false, engaged: true }).action === 'hold');
check('critical supply requests withdrawal but contact still controls movement',
  C.supplyDecision({ supplyPct: 10, engaged: true, /* baseline fields */ }).action === 'return');
```

- [ ] **Step 2: Run the test and observe failure under the old threshold rules**

Run: `node --import ./_ts_resolve.mjs _v48_combat_control_sim.cjs`

Expected: yellow-supply test fails with old S8/S10 return behavior.

- [ ] **Step 3: Change the supply table**

Extend `SupplySituation` with `engaged`. Keep critical supply as a withdrawal request, but for non-critical supply while engaged return `hold` or `pursue`; only an unengaged fleet with no supply path may request return. Preserve the existing return hysteresis only for real return requests.

- [ ] **Step 4: Run the control simulation**

Run: `node --import ./_ts_resolve.mjs _v48_combat_control_sim.cjs`

Expected: all assertions pass.

### Task 3: Integrate the control core in BattleScene

**Files:**
- Modify: `frontend/src/game/scenes/BattleScene.ts`
- Modify: `_v48_combat_control_sim.cjs`

- [ ] **Step 1: Add a failing source-contract test**

```js
const source = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
check('scene imports the central combat controller', source.includes("from '../combatControl'"));
check('scene no longer gives near transport ships a movement target', !source.includes('fleetTargetX = nearAux.x'));
```

- [ ] **Step 2: Run the test and observe failure**

Run: `node --import ./_ts_resolve.mjs _v48_combat_control_sim.cjs`

Expected: missing controller import and existing near-transport movement assignment.

- [ ] **Step 3: Wire one controller state to every fleet**

```ts
const control = advanceManeuver(fleet._combatControl ?? initialControl(fleet), {
  engaged: contact.engaged,
  retreatRequested: supplyOrder.action === 'return' || isManualRetreat,
  headingError: angleDifference(targetHeading, fleet.facingSmooth),
  stopped: Math.hypot(fleet.vx ?? 0, fleet.vy ?? 0) < STOP_EPS,
  reformed: allShipsInAssignedSlots(fleet),
}, simDt);
fleet._combatControl = control;
```

Use controller phase output to select forward/reverse/zero thrust and heading. Remove the old `_uturn`, `_uturnJustEnded`, and independent `turnDiscipline` movement paths once controller equivalence is established. During `turn`, freeze ship world positions and rotate only their hull headings; during `reform`, allocate slots once and move ships at capped speed. A live contact forces the phase back to `disengage`.

- [ ] **Step 4: Correct supply and morale integration**

Move fleet morale recovery/drain outside `fl.units.forEach`. Aggregate supply first, update morale once per fixed simulation step, then apply zero-supply structural damage per ship only when the already-updated fleet morale is zero. In the near-transport branch set target to the current fleet position, not transport coordinates.

- [ ] **Step 5: Run source simulation and type check**

Run: `node --import ./_ts_resolve.mjs _v48_combat_control_sim.cjs`

Run: `npm --prefix frontend run build`

Expected: all simulation assertions pass; build exits 0.

### Task 4: Give missions stable tactical meaning and validate real movement

**Files:**
- Create: `frontend/src/game/tacticalTasks.ts`
- Modify: `frontend/src/game/scenes/BattleScene.ts`
- Modify: `_v48_combat_control_sim.cjs`

- [ ] **Step 1: Add failing task-selection tests**

```js
check('support selects an escort position instead of copying stance only',
  T.resolveTask({ type: 'support_fleet', target: ally }, world).role === 'escort');
check('raid preserves an enemy supply target',
  T.resolveTask({ type: 'raid_supply', target: convoy }, world).targetId === convoy.id);
```

- [ ] **Step 2: Run the test and observe failure**

Run: `node --import ./_ts_resolve.mjs _v48_combat_control_sim.cjs`

Expected: module/function missing.

- [ ] **Step 3: Implement task resolution and use stable fleet IDs**

```ts
export type TacticalRole = 'assault' | 'escort' | 'hold' | 'raid' | 'resupply';
export function resolveTask(mission: Mission, world: TacticalWorld): TacticalIntent;
```

Use fleet IDs only for fleet targets, node IDs only for map targets, and faction IDs only for faction objectives. For escort, target an offset behind/alongside the ally toward the threat instead of copying its stance. Feed the returned intent to the controller, and do not overwrite a player mission during its commitment window.

- [ ] **Step 4: Run focused and full verification**

Run: `node --import ./_ts_resolve.mjs _v40_doctrine_sim.cjs`

Run: `node --import ./_ts_resolve.mjs _v48_combat_control_sim.cjs`

Run: `npm --prefix frontend run build`

Expected: both simulations report zero failures and the frontend build exits 0.

- [ ] **Step 5: Perform a real-scene visual check**

Use the existing battle probe to run a 180-degree free-space turn and a withdrawal under persistent pursuit. Capture positions, phases, ship headings, and screenshots. Verify that ships do not orbit a central point, ships do not change to turn/reform under live pursuit, and ships resume formation after the contact-release delay.
