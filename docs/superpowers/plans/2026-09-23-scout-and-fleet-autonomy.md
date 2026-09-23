# Scout Flights and Fleet Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cloned scout fleets with three lightweight forward scout flights and repair fleet combat interruption, post-capture autonomy, command succession, and attack-source feedback.

**Architecture:** Put deterministic scout and fleet-intent decisions in pure battle modules, then keep `BattleScene` as the Phaser adapter. Scout flights are renderable/targetable contacts but never enter the formal fleet, mission, UI-control, victory, or succession collections.

**Tech Stack:** TypeScript, Phaser, Three.js, Vue 3, Node CommonJS simulation scripts.

---

### Task 1: Pure three-sector scout-flight model

**Files:**
- Create: `frontend/src/game/battle/ScoutSystem.ts`
- Replace: `scripts/scoutLaunchSim.cjs`

- [ ] **Step 1: Write the failing behavioral simulation**

The simulation imports `launchScoutFlights` and `advanceScoutFlight`, asserts sectors `left/centre/right`, headings `parentHeading + [-PI/6, 0, PI/6]`, no commander/mission fields, speed above the supplied fleet speed, forward position growth, report-triggered return, and loss without parent roster mutation.

- [ ] **Step 2: Run the simulation and verify RED**

Run: `node scripts/scoutLaunchSim.cjs`

Expected: FAIL because `ScoutSystem.ts` or its exports do not exist.

- [ ] **Step 3: Implement the pure model**

Export these stable interfaces and functions:

```ts
export type ScoutSector = 'left' | 'centre' | 'right';
export type ScoutPhase = 'outbound' | 'sweeping' | 'returning' | 'lost';
export interface ScoutFlight { id: string; parentFleetId: number; factionId: number; team: number; sector: ScoutSector; x: number; y: number; heading: number; speed: number; hp: number; maxHp: number; sensorRange: number; weaponRange: number; phase: ScoutPhase; launchedAt: number; maxForwardDistance: number; contactId: number | null; }
export function launchScoutFlights(input: ScoutLaunchInput): ScoutFlight[];
export function advanceScoutFlight(flight: ScoutFlight, input: ScoutAdvanceInput): ScoutAdvanceResult;
```

Launch exactly three cruiser-profile flights at ±30°/0°, with speed `max(parentSpeed * 2.2, configuredScoutSpeed)`. Advancing moves toward maximum forward reach, reports the nearest hostile contact within sensor range, returns after a report or sweep timeout, and emits defensive-fire intent when a hostile is within weapon range.

- [ ] **Step 4: Run the simulation and verify GREEN**

Run: `node scripts/scoutLaunchSim.cjs`

Expected: all behavioral assertions pass.

### Task 2: Integrate scout flights without cloning fleets

**Files:**
- Modify: `frontend/src/game/scenes/BattleScene.ts`
- Modify: `frontend/src/game/three/Battle3DOverlay.ts`
- Modify: `frontend/src/App.vue`
- Test: `scripts/scoutLaunchSim.cjs`

- [ ] **Step 1: Extend the failing simulation contracts**

Assert that `BattleScene` owns a separate `scoutFlights` collection, no longer spreads `parent` into a scout fleet, never removes a cruiser from `parent.units`, and exposes AI launch/update adapters. Assert that the overlay identifies scout flights before creating fleet buttons.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/scoutLaunchSim.cjs`

Expected: FAIL on integration assertions.

- [ ] **Step 3: Replace cloned-fleet launch/update code**

Use `launchScoutFlights` from `ScoutSystem.ts`; create minimal Phaser unit containers tagged `_scoutFlight`; keep them outside `globalFleets`; update them before formal fleets; publish reports through `recordScoutReport`; resolve defensive shots and damage without assigning missions, commanders, formations, or fleet controls; clean visuals on return/loss. Remove `_scoutHold` and the parent-stop override.

- [ ] **Step 4: Make rendering/UI scout-specific**

Render scout flights with the cruiser model and a compact `侦察·左/中/右` status. Do not create portrait, posture, EW, split, mission, selection, or right-click controls. Remove the generic App fleet control path for scout data.

- [ ] **Step 5: Run and verify GREEN**

Run: `node scripts/scoutLaunchSim.cjs`

Expected: all pure and integration assertions pass.

### Task 3: AI scout parity and launch lifecycle

**Files:**
- Modify: `frontend/src/game/battle/ScoutSystem.ts`
- Modify: `frontend/src/game/scenes/BattleScene.ts`
- Test: `scripts/scoutLaunchSim.cjs`

- [ ] **Step 1: Add failing assertions**

Assert `shouldLaunchScouts` returns true for a formal fleet with stale/no contacts and no live flights, false during cooldown or while a flight is live, and works identically for player-team AI and hostile AI.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/scoutLaunchSim.cjs`

Expected: FAIL because automatic launch policy is absent.

- [ ] **Step 3: Implement and integrate launch policy**

Export `shouldLaunchScouts({ now, lastContactAt, cooldownUntil, liveFlightCount })`. Call it from the 1 Hz AI loop for non-player-controlled formal fleets; manual launch uses the same cooldown and live-flight limits.

- [ ] **Step 4: Run and verify GREEN**

Run: `node scripts/scoutLaunchSim.cjs`

Expected: AI parity and lifecycle assertions pass.

### Task 4: Combat/mission arbitration and post-capture autonomy

**Files:**
- Create: `frontend/src/game/battle/FleetIntentSystem.ts`
- Modify: `frontend/src/game/scenes/BattleScene.ts`
- Create: `scripts/fleetIntentSim.cjs`

- [ ] **Step 1: Write failing intent tests**

Test that incoming fire permits return fire without replacing a beacon/capture destination; identified nearby enemies interrupt capture movement but preserve the mission; cleared contact resumes the mission; no remaining capture target chooses known enemy, then fighting ally, then forward search, then key-objective patrol.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/fleetIntentSim.cjs`

Expected: FAIL because `FleetIntentSystem.ts` does not exist.

- [ ] **Step 3: Implement the pure arbiter**

Export:

```ts
export type FleetIntentKind = 'survive' | 'engage' | 'mission' | 'beacon' | 'support' | 'search' | 'patrol';
export interface FleetIntent { kind: FleetIntentKind; destination: { x: number; y: number } | null; fireTargetId: number | null; missionPaused: boolean; reason: string; }
export function resolveFleetIntent(input: FleetIntentInput): FleetIntent;
```

Keep movement destination and `fireTargetId` independent. Preserve mission data while `missionPaused`; choose deterministic autonomy fallback when no mission destination remains.

- [ ] **Step 4: Integrate into BattleScene**

Use the arbiter at the final destination/fire boundary so mission destinations cannot suppress firing and combat cannot erase capture progress. On capture completion, clear the finished mission and immediately assign the selected autonomous intent rather than defaulting to castle position.

- [ ] **Step 5: Run and verify GREEN**

Run: `node scripts/fleetIntentSim.cjs`

Expected: all arbitration and fallback assertions pass.

### Task 5: Succession and firing-contact disclosure

**Files:**
- Modify: `frontend/src/game/TacticalCommandSystem.ts`
- Modify: `frontend/src/game/scenes/BattleScene.ts`
- Modify: `frontend/src/game/battle/IntelSystem.js`
- Modify: `frontend/src/game/battle/IntelSystem.d.ts`
- Modify: `scripts/commandSystemSim.cjs`
- Modify: `scripts/intelSystemSim.cjs`

- [ ] **Step 1: Add failing regression assertions**

Assert formal-fleet eligibility rejects scout flights/auxiliaries/empty fleets; a surviving formal fleet succeeds a destroyed supreme commander even while that commander's scout survives; incoming fire creates a temporary firing contact with attacker id/bearing but without leaking full roster data.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/commandSystemSim.cjs; node scripts/intelSystemSim.cjs`

Expected: FAIL on eligibility and firing-contact assertions.

- [ ] **Step 3: Implement formal-fleet eligibility and succession**

Export `isFormalCommandFleet(fleet)` and use it consistently in commander computation, survival checks, successor selection, direct-control UI, and fleet picking. Scout flights never carry `commanderId`.

- [ ] **Step 4: Implement firing-contact disclosure**

Record `{ attackerId, x, y, bearing, expiresAt, state: 'contact' }` on damage. Feed it to the same contact aggregation used by UI and fire-control return fire; display a concise combat-log message without revealing hidden composition.

- [ ] **Step 5: Run and verify GREEN**

Run: `node scripts/commandSystemSim.cjs; node scripts/intelSystemSim.cjs`

Expected: all regression assertions pass.

### Task 6: Full verification and visual smoke test

**Files:**
- Verify all modified files

- [ ] **Step 1: Run battle simulations**

Run all repository battle simulations, including `scoutLaunchSim.cjs`, `fleetIntentSim.cjs`, `commandSystemSim.cjs`, `intelSystemSim.cjs`, `aiDirectorSim.cjs`, and `tacticalCombatSim.cjs`.

Expected: zero failed assertions.

- [ ] **Step 2: Run frontend build**

Run: `npm run build` in `frontend`.

Expected: `vue-tsc --noEmit` and Vite build exit 0.

- [ ] **Step 3: Run a browser smoke scenario**

Verify one manual player launch shows three fast forward scout craft without fleet buttons; friendly AI launches scouts; a capture fleet returns fire and resumes capture; destroyed supreme commander transfers controls; post-capture fleet continues autonomous action; every shield ripple has a visible beam/contact bearing or log source.

