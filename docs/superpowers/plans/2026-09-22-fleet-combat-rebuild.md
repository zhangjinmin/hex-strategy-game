# Fleet Combat Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild tactical fleet combat around one deterministic command, movement, reconnaissance, logistics, morale, attrition and visual-representation model, so fleet behaviour remains legible, physical and tactically meaningful.

**Architecture:** Split decision-making from simulation and rendering. A battle tick first produces a `BattleIntent` from command state and intelligence, then advances immutable fleet/unit state, then produces combat events consumed by UI/2D/3D. No renderer, formation helper, logistics code or AI routine may directly overwrite another layer's position, target, formation or casualties.

**Tech Stack:** Vue 3, TypeScript, Phaser, Three.js, Pinia, existing CommonJS simulation scripts, GLB assets and offline GLB LOD generation.

---

## Confirmed product decisions

| Area | Decision |
|---|---|
| Player beacon | A player beacon is an exclusive order to its owner fleet; other friendly fleets cannot retarget or rotate it. |
| Transport ships | Targetable and destructible; never count as combat hulls for victory, target selection or formation frontage. Destroying them is a valid logistics strategy. |
| Movement | Every ship retains position, velocity and heading. Formation changes are phased manoeuvres, not a collapse-to-centre then teleport. |
| Fog of war | Unknown → contact → identified → resolved. Recon/electronic warfare/decoys change information, not hidden combat modifiers. |
| Flagship | Rear-centre command slot. Destruction causes a command shock; a valid successor may take command. Collapse requires failed succession or compounded morale/command failure. |
| Supply | Supply loss first lowers morale and combat readiness; hull loss follows only after morale breaks or the fleet is actively attacked. |
| Models | `electronic` becomes a canonical ship type. It needs an explicit visual profile; until dedicated GLBs exist, a labelled cruiser-derived fallback is allowed. |

## Workstream map and file ownership

| Responsibility | Primary files | New focused modules |
|---|---|---|
| Battle state/tick boundary | `frontend/src/game/scenes/BattleScene.ts` | `battle/BattleState.ts`, `battle/BattleTick.ts`, `battle/BattleEvents.ts` |
| Command/AI and manoeuvre | `frontend/src/game/aiDirector.ts`, `frontend/src/game/fleetKinematics.ts`, `frontend/src/config/formationLayout.ts` | `battle/CommandSystem.ts`, `battle/FormationSystem.ts` |
| Combat, roster, attrition | `frontend/src/game/combatRoster.ts`, `frontend/src/game/combatRepresentation.ts` | `battle/CombatSystem.ts`, `battle/MoraleSystem.ts` |
| Recon, fog and EW | `frontend/src/config/gameData.ts` | `battle/IntelSystem.ts`, `battle/ScoutSystem.ts` |
| Supply | `frontend/src/game/SupplyChainSystem.ts` | `battle/LogisticsSystem.ts` |
| Composition and visuals | `frontend/src/config/shipScaling.ts`, `frontend/src/game/three/shipModels.ts`, `frontend/src/game/three/Battle3DOverlay.ts` | `config/shipProfiles.ts`, `tools/generateShipLod.mjs` |
| UI | battle HUD components and `BattleScene` UI payload | `battle/BattleHudState.ts` |
| Regression tests | `scripts/*Sim.cjs` | one focused simulation script per new subsystem |

## Delivery order

### Phase 0 — Freeze contracts and baseline scenarios

- [ ] Record the current dirty working-tree changes without overwriting them; retain `aiDirector.ts`, `fleetKinematics.ts`, `combatRoster.ts` and `combatRepresentation.ts` as reference/prototype material only.
- [ ] Add `docs/design/fleet-combat/01-state-contract.md` defining `FleetState`, `UnitState`, `BattleIntent`, `Contact`, `BattleEvent` and their sole writers.
- [ ] Create deterministic fixtures for: beacon order isolation; wedge-to-line manoeuvre; equal fire duel; supply-line raid; flagship loss with successor; scout loss; carrier/EW composition.
- [ ] Add `scripts/battleBaselineSim.cjs`; it must replay each fixture with a fixed seed and assert the same outcome twice.
- [ ] Acceptance: a test run can report fleet positions, active orders, casualties, morale, supply and victory reason without Phaser or Three.js.

### Phase 1 — Establish a single simulation tick

- [ ] Write failing tests for the order `intel → command intent → movement → weapons → morale/logistics → attrition → events`.
- [ ] Create `frontend/src/game/battle/BattleState.ts` with serialisable state only; sprites, meshes and UI objects are forbidden in this module.
- [ ] Create `BattleTick.ts` with one public `advanceBattle(state, dt, rng)` function and an event array return value.
- [ ] Move writes currently scattered through `BattleScene.ts` behind subsystem calls; retain the scene as input adapter/render-event consumer.
- [ ] Acceptance: pausing rendering does not alter simulation results, and a replay serialized at tick N resumes to the same result.

### Phase 2 — Command, movement and formations

- [ ] Define `FleetOrder`: `hold`, `advance`, `approach`, `beacon`, `withdraw`, `screen`, `scout`, `strikeFlagship`; every order has issuer, priority, expiry and cancellation reason.
- [ ] Implement exclusive beacon ownership in `CommandSystem.ts`; friendly AI can observe but cannot replace that fleet's beacon intent.
- [ ] Implement `FormationSystem.ts` phases: align heading, translate slots at capped speed, settle spacing. A formation's anchor and facing interpolate; units never target the fleet centre as an intermediate destination.
- [ ] Keep transport ships in a rear logistics column with their own low acceleration and heading-aligned movement; no sideways snap.
- [ ] Extend `scripts/fleetKinematicsSim.cjs` with 90°/180° turns, moving beacon, reform-under-fire and retreat-with-transports cases.
- [ ] Acceptance: maximum displacement per tick is bounded for every hull; a formation switch preserves fleet cohesion and no unit teleports behind the fleet.

### Phase 3 — Targeting, fire and attrition

- [ ] Replace ad-hoc target loops with `CombatSystem.ts`: target eligibility, target score, weapon range/arc, salvo resolution and event emission are explicit functions.
- [ ] Maintain two predicates: `isCombatHull` for command/victory/frontage and `isTargetableHull` for weapons. Supply is false for the first and true for the second.
- [ ] Make visual hull disappearance derive from a stable attrition projection, not the order that units happen to be iterated or rendered.
- [ ] Add target policies: line engagement, protect logistics, suppress scouts/EW, raid logistics, and flagship strike. Each policy exposes its risk in UI.
- [ ] Extend `scripts/combatRosterSim.cjs` and `scripts/combatRepresentationSim.cjs` to cover transport destruction, stable casualty display and a damaged enemy whose remaining hull count visibly matches strength.
- [ ] Acceptance: combat end is caused by combat-hull collapse/withdrawal, while transport destruction remains strategically decisive through supply and morale.

### Phase 4 — Supply, morale, command shock and retreat

- [ ] Add `MoraleSystem.ts` with bounded morale (0–100), contributors, thresholds and events: advantage surge, command shock, resupply recovery, isolation, route, surrender/stragglers.
- [ ] Change logistics resolution to `supply shortfall → readiness/morale loss → reduced fire/formation integrity → hull losses only at zero morale or under combat damage`.
- [ ] Add named flagship and ordered successor slots to fleet composition. Place command ship in the rear-centre formation slot.
- [ ] Resolve flagship loss as: immediate morale shock, command delay, successor selection, then either recovery or progressive disorganisation. Do not instantly erase all ships.
- [ ] Add withdrawal behaviour: combat hulls retreat in formation; stragglers are represented as losses/events rather than instant rear teleportation.
- [ ] Acceptance: the HUD explains every rapid collapse with a chain of visible events rather than an unexplained health-bar jump.

### Phase 5 — Fog, scouts, electronic warfare and decoys

- [ ] Implement `IntelSystem.ts` contact states and decay rules: unknown, anomaly, contact, identified, resolved/last-known.
- [ ] Implement `ScoutSystem.ts` using actual detached destroyer/electronic units sent left/centre/right; loss yields a `scout-lost` event and removes its sensor contribution.
- [ ] Add electronic warfare actions: extend/reduce detection, false contact/decoy, jam target identification, counter-jam. Effects must reference a source unit and have a duration/counterplay.
- [ ] Gate AI decisions by known contacts; it must not select or perfectly face an unseen fleet.
- [ ] Add deterministic tests for discovery, scout loss, jammer/anti-jammer, decoy expiry and AI refusing omniscient targeting.
- [ ] Acceptance: opening play becomes search, screen and information contest; direct line-of-sight engagements remain possible but are not guaranteed.

### Phase 6 — Fleet composition, doctrine and visual identity

- [ ] Replace the closed `ShipType` list in `frontend/src/config/shipScaling.ts` with canonical profiles in `frontend/src/config/shipProfiles.ts`: `battleship`, `fast_battleship`, `cruiser`, `destroyer`, `carrier`, `fighter`, `electronic`, `supply`.
- [ ] Give every profile one source of truth for composition key, Chinese label, combat role, sensor/EW value, targetability, formation slot class, model key, fallback key and UI icon.
- [ ] Update simulation composition so doctrine determines minimum role quotas, not just percentages. Example: reconnaissance-capable fleets always spawn an electronic/scout element; carrier doctrine guarantees at least one carrier and an air wing if the visual budget permits.
- [ ] Remove duplicate alias tables from `shipModels.ts` and `Battle3DOverlay.ts`; both must read ship profiles. Map `电子` explicitly to electronic assets/fallback, and map `空母`/`舰载` explicitly.
- [ ] Verify assets: carrier/fighter models already exist; create `empire_electronic.glb` and `alliance_electronic.glb` or declare a visible antenna/ECM fallback until art is delivered.
- [ ] Acceptance: tactical simulation UI, actual spawned entities and 3D models show the same composition counts by ship role.

### Phase 7 — Automatic model LOD asset pipeline

- [ ] Add a repository-owned GLB simplification tool, `frontend/tools/generateShipLod.mjs`, using a pinned offline dependency; it reads `*.glb` and emits `.lod1.glb`, `.lod2.glb`, then rewrites `shipLodManifest.json` atomically.
- [ ] Add a Vite development watcher that queues generation after a new/changed source GLB is stable, ignores files already ending in `.lod1.glb`/`.lod2.glb`, and avoids recursive self-triggering.
- [ ] Add `npm run models:lod:check` for CI/build verification: it reports missing/outdated LOD files but never mutates assets in production build.
- [ ] Preserve source model FX anchors in generated LODs where the simplifier supports them; otherwise preserve base-model anchor reuse and state it in generated metadata.
- [ ] Add fixture tests using a tiny GLB: new source produces two files; rerun is idempotent; modified source regenerates; malformed source reports its filename without deleting prior LODs.
- [ ] Acceptance: adding `new_ship.glb` while the dev server runs creates the two LOD assets and a manifest entry without a manual command.

### Phase 8 — HUD, tactical controls and observability

- [ ] Define `BattleHudState.ts` from battle events/state: flagship integrity, supply, morale, command status, contact confidence, scouts, EW effects, active doctrine/order and collapse reason.
- [ ] Add controls for beacon, scouting sectors, screen/withdraw, flagship strike, logistics raid, decoy and EW only when relevant ships/contacts exist.
- [ ] Add concise notifications: contact acquired/lost, scout destroyed, enemy command shock, supply route severed, morale surge, successor assumes command.
- [ ] Add a developer combat timeline and fixed-seed replay export for diagnosis; it is hidden outside debug mode.
- [ ] Acceptance: a player can explain why a fleet turned, reformed, stopped firing, collapsed or survived by reading the event timeline.

### Phase 9 — Migration, performance and release gate

- [ ] Migrate one battle mode at a time behind a temporary `battleSimulationVersion` save flag; never run old and new writers on the same fleet.
- [ ] Replay recorded fixtures against both modes and manually review the 3D scenarios: turn, wedge/line transition, transport raid, fog search, carrier strike, flagship succession.
- [ ] Run `npm run build` in `frontend`, all `scripts/*Sim.cjs` tests, and a 10-minute soak with changing camera/LOD.
- [ ] Remove obsolete direct state writers, legacy deck fallback and duplicate class aliases only after parity cases pass.
- [ ] Acceptance: no teleport/reform regression, no omniscient AI, no invisible carrier/EW role, and stable frame time under the intended fleet cap.

## Milestones

1. **Foundation:** Phases 0–2 — visible movement is physically credible and player orders cannot be hijacked.
2. **Credible battle:** Phases 3–4 — casualties, logistics, morale and collapse are explainable.
3. **Tactical depth:** Phases 5–6 — scouts, fog, EW, doctrine, carriers and flagship tactics create choices before and during firing.
4. **Production readiness:** Phases 7–9 — assets scale automatically and regressions are replayable.

## Explicit non-goals for the first rebuild

- Per-ship crew simulation or individual escape pods.
- Full real-time physics collision between all hull meshes.
- Automatic generation of original art or an electronic-ship GLB from code; the pipeline creates LODs only from supplied source GLBs.
- Perfect information for AI or hidden numerical bonuses that the player cannot inspect.

## Review checkpoints

- After Phase 2: approve manoeuvre feel from recorded video before touching damage balance.
- After Phase 4: approve morale/flagship collapse rules before adding fog and EW.
- After Phase 6: approve role quotas and model profile table before creating the new electronic art.
- After Phase 9: ship only after deterministic replay, type-check/build and manual tactical-video review all pass.
