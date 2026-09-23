# Scout Flights and Fleet Autonomy Design

## Purpose

Replace reconnaissance-as-a-cloned-fleet with lightweight three-direction scout flights, and make combat response, mission execution, post-mission autonomy, command succession, and combat feedback share one coherent authority model.

## Confirmed product decisions

- One reconnaissance command launches three lightweight scout craft toward forward-left, forward-centre, and forward-right.
- Scout craft use the cruiser model but do not remove ships from the parent fleet's represented combat roster. A few scout craft are negligible beside a fleet of thousands.
- Scout craft are targetable and can be lost, but they are not fleets: they have no commander, formation, mission panel, fleet controls, split button, victory weight, or succession eligibility.
- Player, friendly AI, and enemy AI use the same scout-flight rules.
- The parent fleet continues its mission while scouts are active.
- Formal fleet movement orders and weapons fire are independent: a fleet may continue moving toward a beacon or mission destination while returning fire.

## Architecture

### Scout flight subsystem

`frontend/src/game/battle/ScoutSystem.ts` owns pure reconnaissance state and decisions. A `ScoutFlight` contains identity, parent fleet identity, faction/team, sector, position, heading, speed, hit points, sensor range, weapon range, phase, timestamps, and last contact. It contains no Phaser, Three.js, commander, mission, or formation state.

The subsystem exposes creation and update functions. Launch produces exactly three flights at -30, 0, and +30 degrees relative to the parent heading. Flights move faster than line fleets and progress through `outbound`, `sweeping`, `returning`, and `lost`. They prefer maximum forward reach, report contacts, evade threats, return fire within their small defensive range, then return or expire. Loss creates a directional report and launch cooldown but does not modify fleet composition.

`BattleScene` adapts pure flight state to small Phaser unit containers so the existing Three overlay can render cruiser models. The overlay renders a compact scout label only and never creates fleet control buttons for a scout flight.

### Command and combat arbitration

Formal fleets resolve intent in this priority order:

1. survival and rout;
2. response to incoming fire;
3. engagement with an identified nearby enemy;
4. player beacon or assigned mission;
5. autonomous action.

Movement and firing are separate outputs. A capture, support, beacon, or withdrawal order determines destination, while the fire gate independently permits combat or return fire. Incoming fire exposes the attacker as a firing contact even when full identification is unavailable.

Capture missions pause during combat and resume when contact is released. When no capturable objective remains, a fleet clears the mission and chooses, in order: attack a known enemy, support the nearest fighting ally, search along the hostile/front direction, then patrol a key owned objective. It never falls back to an unexplained permanent stop.

### AI reconnaissance

AI launches scouts when it has no live scout flight and its forward contact information is absent or stale. Launch is rate-limited per parent fleet. Friendly and hostile AI use the same condition and the same three sectors; no side receives omniscient target positions.

### Succession and UI

Only living formal combat fleets participate in supreme-commander survival checks and successor selection. Scout flights, auxiliary transports, and empty fleet shells are excluded.

Scout flights display sector, outbound/returning/lost state, and health. They are not selectable as formal fleets and cannot receive right-click beacons. When the current supreme commander's formal fleet is destroyed, succession runs immediately and the replacement fleet's direct controls become available.

### Combat feedback

A real hit may create a shield ripple. Every hit also registers its firing source. If the attacker is not fully identified, the target side receives a temporary firing-contact bearing and combat log entry so shield feedback never appears source-less.

## Failure handling

- Launch requests during cooldown or when three live flights already exist are rejected with a concise status message.
- A destroyed parent orders surviving flights to return to the nearest friendly formal fleet; if none exists, they expire.
- Missing or destroyed scout visuals never affect the pure reconnaissance state or formal-fleet victory checks.
- Invalid mission targets clear the mission and immediately enter autonomous action selection.

## Verification

Deterministic simulations must prove three-sector launch geometry, faster forward movement, contact/report/return transitions, loss isolation from fleet strength, AI launch parity, scout exclusion from UI/succession, capture interruption and resumption, post-capture autonomy, return fire during beacon movement, and firing-contact disclosure. The frontend type-check/build and existing battle simulations remain release gates.
