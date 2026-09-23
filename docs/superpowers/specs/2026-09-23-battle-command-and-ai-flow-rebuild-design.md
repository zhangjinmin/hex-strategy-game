# Battle Command and AI Flow Rebuild Design

## Purpose

Replace the current patch-on-patch battle flow with one explicit authority model covering reconnaissance, direct RTS orders, fleet missions, retreat/rout, command succession, fog-of-war objectives, tactical splitting, and battle-stall recovery.

This design extends the scout-flight work already present in the repository. It does not reintroduce scout fleets or deduct their negligible craft from a line fleet's represented ship count.

## Confirmed product decisions

- Right-clicking empty space issues an immediate move order.
- Right-clicking an identified hostile fleet issues an explicit attack order. The ordered fleet pursues until the target is destroyed, leaves reliable tracking, or the player gives a new order; it then holds position.
- The currently controllable supreme-command fleet responds without command-channel latency.
- A player-controlled fleet with no order holds its opening deployment instead of automatically searching, turning, or splitting.
- Reconnaissance is a faction-level capability, not one three-craft launch per formal fleet.
- Hostile opening bases obey fog of war. Once positively identified, a base or fleet remains in long-term intelligence memory unless a future deception/electronic-warfare mechanic explicitly invalidates that track.
- Admiral personality affects tactical-plan preference, but never causes splitting by itself.

## Authority and state model

Every formal fleet resolves one authoritative order in this priority order:

1. destroyed or true rout;
2. direct player order;
3. active committed tactical-plan role;
4. assigned strategic mission;
5. local combat response;
6. autonomous posture.

Movement and fire control remain separate outputs. A fleet can return fire while moving, but an explicit attack order owns its movement target until its completion condition is met.

Only a true rout may reject a direct order. Ordinary low-hull withdrawal, regrouping, collision avoidance, formation reform, and AI maneuver state are cancellable by a new direct order. Accepting a direct order clears stale movement-controller state and produces a visible acknowledgement only after the order has actually become authoritative.

### Direct move

A direct move stores an exact world destination, clears attack pursuit and cancellable fallback/regroup state, and enters a short turn/accelerate transition. Arrival changes the fleet to hold. Local fire control may engage threats in range without silently converting the move into a pursuit.

### Direct attack

A direct attack stores a target fleet identity rather than only its current tile. The attacker continuously resolves the target's latest reliable track, faces and closes on that track, and fires when geometry permits. It ends when the target is destroyed, reliable tracking is explicitly broken, or a new order replaces it. Completion changes the fleet to hold.

### Retreat, rout, and deadlock

Retreat is divided into:

- `withdrawing`: damaged but commandable;
- `regrouping`: temporarily reforming near supply or allies and commandable;
- `routed`: morale-collapse state that temporarily refuses normal orders.

Hull percentage alone cannot create a permanent non-commandable state. Regrouping ends by recovery, timeout, or a direct supreme-command order. Routed fleets either recover morale, leave the battlefield, or are destroyed.

A battle-stall watchdog observes meaningful displacement, range closure, objective progress, and weapons fire. If hostile forces remain but neither side progresses for a bounded interval, AI fleets must choose one of advance, objective pressure, or withdrawal; the watchdog never fabricates damage or teleports fleets.

## Reconnaissance lifecycle

Each faction may own one active reconnaissance detachment represented by at most three cruiser-model craft: forward-left, forward-centre, and forward-right. The detachment has one lifecycle, one launch cooldown, and one summarized status. Splitting or creating additional formal fleets does not increase this cap.

Search legs are planned from the faction's deployment centre, current battlefront, hostile approach estimate, and unexplored sectors. Scouts maximize forward coverage rather than orbiting their parent fleet. On contact, the best-positioned craft shadows the target while the others widen coverage or return. A tracked contact remains the detachment's priority until destroyed, handed to friendly sensors, or explicitly lost through a supported counter-intelligence rule.

Routine launch, sector return, and ordinary sweep transitions do not create global toast notifications. Notifications are reserved for first positive contact, material change in hostile strength or bearing, reconnaissance losses, and loss of an important track. All scout updates and pending notifications stop when battle resolution begins.

## Fog and intelligence

Rendering consumes team-scoped intelligence rather than raw faction data.

- Unknown hostile fleets and bases are not rendered.
- A firing hostile generates an immediate combat contact and cannot disappear during an exchange.
- Positive identification creates a persistent known-object record with last confirmed position and time.
- A known fleet outside live vision is shown as a last-known intelligence contact, not as omniscient real-time movement.
- A known fixed base remains visible at its confirmed location.
- Only an explicit electronic-warfare/deception transition may downgrade or invalidate a known track.

This rule applies equally to 3D models, rings, labels, terrain/objective markers, targeting, and mission selection.

## Command succession

Supreme-command succession is a runtime authority change, not only a store value update. When the current commander is lost:

1. choose the next eligible living formal fleet;
2. update the store and battle scene authority;
3. clear a destroyed selection;
4. rebuild direct-control affordances for the successor;
5. select and highlight the successor when no other valid controllable fleet is selected;
6. acknowledge that real-time command is now available.

Billboard controls must be derived from current authority on every relevant update, not frozen when the billboard was first created.

## Tactical plans and splitting

AI uses a plan lifecycle:

1. assess force ratio, geography, objectives, intelligence quality, supply, and available maneuver room;
2. choose concentration, frontal pressure, flank, pincer, fixing action, reserve, or withdrawal;
3. decide whether the plan actually requires detachments;
4. assign each detachment a role, route, rendezvous/commit trigger, target, and abort condition;
5. synchronize commitment;
6. exploit, regroup, or cancel.

Splitting is forbidden when force size, hull state, available space, contact quality, or coordination capacity is insufficient. It is also forbidden for a directly controlled player fleet unless the player explicitly requests it. Personality adjusts scoring: Mittermeyer may prefer tempo/flanking and Yang may prefer deception/reserve, but either commander may reject splitting when conditions do not support it.

Every detached force must have a tactical purpose and a completion path. A detachment that misses its trigger, loses its target, or reaches its abort threshold rejoins or receives a new coherent role; it never remains split merely because the opening planner created it.

## Interface and terminology

### Pointer feedback

Ground left-click does not create a map marker. A successful right-click move briefly shows a compact destination chevron/ring at the exact point. A successful right-click attack briefly shows a hostile target-lock marker. The existing persistent oversized hex indicator is removed.

### Fleet billboard

The inline controls are consolidated into three concepts:

- `态势`: current order, tactical role, combat state, and damage state;
- `行动`: context-sensitive reconnaissance, electronic warfare, hold/cancel, and related special actions;
- `分舰`: opens deliberate detachment planning and is not an instant personality-driven split.

Movement and attack are not duplicated as permanent buttons because right-click provides them directly. Controls update immediately when selection or command authority changes.

### Mission language

Mission names and status use concise operational language inspired by the setting while remaining unambiguous:

- `进击敌舰队` — pursue and defeat a named hostile force;
- `夺取战略据点` — capture a named base or objective;
- `固守战区` — hold a named area and engage threats entering it;
- `协同友军` — support a named friendly force;
- `撤回整补` — withdraw to a named supply point.

Runtime intent is shown separately, for example `奉令：右翼迂回`, `临机：追击敌旗舰`, `交战：压制敌前卫`, or `整补：向最近补给线撤回`. The text must expose what the fleet is doing and why, without leaking hidden enemy information.

## Failure handling

- A right-click attack on an invalid or already destroyed target is rejected without replacing the current order.
- If a target is no longer live-visible but has a reliable persistent track, pursuit uses the last-known track and labels it accordingly.
- If reliable tracking is explicitly broken, attack completes as `目标失联` and the attacker holds.
- If no eligible successor exists, direct command is disabled with an explicit command-collapse state rather than misleading `实时指挥` text.
- Battle-end cleanup destroys scout visuals, cancels queued reconnaissance events, suppresses new tactical toasts, and removes transient pointer markers.

## Verification

Deterministic simulations and integration contracts must prove:

- one reconnaissance detachment and no more than three scout visuals per faction regardless of fleet count or splitting;
- direct move and direct attack semantics, including pursuit completion and immediate supreme-fleet response;
- direct orders clear cancellable retreat/regroup/maneuver states but not true rout;
- player-controlled fleets hold at opening without unsolicited turns or splits;
- firing contacts remain visible throughout an exchange and known contacts persist correctly;
- hostile bases are hidden until discovered;
- succession refreshes selection and direct-control UI;
- pointer feedback contains no persistent large hex;
- routine scout transitions do not spam notifications and battle-end cleanup is silent;
- AI splitting requires a qualified plan with roles, triggers, abort conditions, and regrouping;
- low-hull opposing forces cannot remain in an infinite stationary retreat loop;
- mission and intent labels match the new terminology;
- the full battle simulation suite and production frontend build pass.
