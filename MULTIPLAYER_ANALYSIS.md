Disclaimer: Written by AI.
This report was part of a conversation in the Boxel Community.
# Shared-physics multiplayer: analysis

What it would take to let several players share one physics world in Boxel 3D, what levels for it would look like, and whether it would be fun.

## 1. Summary

- **Feasible, but it is an engine refactor plus real netcode, not an extension of today's multiplayer.** Today's mode draws other players as ghosts. A shared world needs every player's body in every client's simulation, kept identical.
- **Recommended netcode: rollback on top of the existing deterministic mode.** Peers exchange inputs only, over the existing PeerJS connections. Boxel's inputs are tiny, the deterministic mode already makes the simulation bit-exact across browsers, and the TAS tooling has shown it.
- **Biggest design problems:**
  - gravity is global;
  - a death resets the whole level;
  - players re-arm their jump on each other;
  - many existing levels assume one player.
- **Recommended path:** prototype **local** multiplayer first (two players on one screen, no network) to find out cheaply whether it's fun. Then add rollback netcode, then gamemode blocks and a small purpose-built level pack.
- **Fun:** yes for co-op puzzles (Pico Park style) and party races on purpose-built levels. Not by turning collisions on in existing levels; keep ghost mode for those.

## 2. What exists today

`src/js/Network.js` and `src/js/Multiplayer.js` implement **ghost multiplayer**:

- PeerJS (WebRTC data channels) with a star topology. The host relays everyone's state, and connections close after 5 s without a heartbeat.
- Each client sends its rendered position, rotation, scale, skin, name and current level about 10 times a second. Remote players are tweened between samples.
- Remote players are plain `Player` meshes with **no physics bodies**, shown only when they are on the same level.

This is a good base for lobbies, names, skins and the connection layer. None of it touches the physics.

## 3. Engine changes for a shared physics space

### 3.1 The player is a singleton

`app.player` is referenced 63 times across six files: App, Collision, Level, LevelEditor, Mouse and Multiplayer. The important part is `Collision.js`, which applies every effect to `app.player` no matter which body touched the block:

- jump re-arm;
- kill on spikes;
- checkpoint, shrink and grow;
- grapple, control and unlimited-jump modes;
- finish and reset.

All of this has to look up the player that owns the touching body. The same goes for:

- Mouse/grapple aiming;
- the jump indicator;
- the camera;
- death/respawn timers;
- level start and retry.

### 3.2 State that is global today but per player in a shared world

| Mechanic | Today | Shared-world decision |
|---|---|---|
| Gravity block | Sets `engine.world.gravity` for everything (`App.updateGravity`), and rotates the camera | Either **per-player gravity** (players get their own gravity force while the world keeps the default for blocks), or **shared gravity as a mechanic** (one player flips it for everyone: chaotic, but a great co-op tool). Most existing gravity levels only work per player. |
| Death | `kill()` → respawn → `Level.resetLevel()` resets every block | A per-player respawn at that player's checkpoint, with no level reset. Shared dynamic blocks persist, plus a vote or host "reset level" button. |
| Tips | Pause the game (`play = false`) | Show a local overlay without pausing. |
| Timer and finish | One run timer; the finish ends the level | Per-player finish times. The end condition depends on the gamemode: first, everyone, or the team. |
| Direction force, mode, size, rope | Already per player (`player.force`, `mode`, scale, `rope`) | Keep per player. Ropes currently can't attach to players (`class != "player"` in `addRope`); allowing it would be a deliberate tether mechanic. |
| Camera | Follows the one player and rotates with gravity | One camera per local player, with off-screen arrows for teammates. Online, each client follows its own player. |

### 3.3 Player-to-player contact

- Players are boxes, so they push, block and stack. Touching **any** body re-arms the jump, so two players can climb forever by jumping off each other (a "human ladder").
  - That can be the core co-op mechanic, or an exploit in races.
  - Make it a per-gamemode rule: full collision; collision without jump re-arm from players; or no collision (ghosts).
- In jump mode you can't steer, so being bumped feels random. Bumps should be rare or deliberate in race levels.
- Spin from jumps makes contacts between rotating boxes chaotic. That's fun in a party mode and frustrating in precision levels.

### 3.4 Shared dynamic objects

Dominoes, doors, loose blocks and dynamic finishes become shared puzzle state:

- One player can open a path, or ruin it, for everyone.
- With per-player respawns these objects no longer reset when someone dies, so levels need a reset lever or must be designed to be robust.
- **A real example from the TAS work, Campaign 29:** its finish box has a sliding door. One player pushing it gets it about 12 units open; a player needs 16. Two players pushing together could plausibly open it. That's a ready-made co-op puzzle shape.

## 4. Netcode

### 4.1 Options

| Model | How it works | Fit for Boxel |
|---|---|---|
| **Host-authoritative state sync** | The host simulates. Guests send inputs, predict their own player and correct to the host's snapshots. | Works with nondeterministic physics, but stacking and pushing players jitter under correction, and a host with lag hurts everyone. Snapshots of every dynamic body are big on large levels. |
| **Deterministic lockstep** | Everyone simulates; only inputs are exchanged, and a tick runs once all inputs for it have arrived. | Simplest and exact, but adds the full round-trip delay to every input. Bad for a precision platformer. |
| **Rollback (GGPO-style)** — recommended | Everyone simulates and guesses remote inputs (repeat the last one). When a real input arrives late, restore a snapshot and re-simulate the missed ticks. | Local input stays instant and the world stays identical. It needs determinism and fast save/restore, both of which this project already has (below). |

### 4.2 Why rollback is realistic here

- **Inputs are tiny.** Each tick has at most a few commands from a closed set, the same ones the TAS format uses:
  - `j` (jump), `a`/`d` hold and `A`/`D` release;
  - `g<angle>` (grapple aim) and `G` (release);
  - `c` (respawn).

  A tick usually has none, so a packet is a few bytes.
- **Determinism exists.** Deterministic mode runs fixed 60 Hz physics ticks with fall-out kills and respawns on ticks. The Deterministic Math setting (Chrome and Firefox tables) makes trig identical across browsers. The Rust port reproduces the game bit for bit: 442 of 442 saved runs replay exactly. A session must **force** one math table and deterministic mode for every peer.
- **Save and restore exist.** The TAS simulator's `Snapshot` (`tas/sim/snapshot.js`) captures and restores the whole matter.js world. The solvers use it constantly. The game would need the same thing for its own world, plus the matter `Common._nextId` counter, which the TAS sim already saves.

### 4.3 Determinism hazards to audit

- **Anything that reads render state.** In non-deterministic mode, resize and grapple read the interpolated render transform, so the deterministic path must be used throughout.
- **Bodies created during play** (death particles, ropes, joints): they must be created in the same order with the same ids everywhere.
- **Wall-clock timers** (`setTimeout`, `Date`) and `Math.random` in anything that affects physics.
- **Effects that happen in render callbacks rather than physics ticks.**
- **Per-client settings that change physics.** Invalidating settings must match across the session, and the host's should be broadcast at start.

### 4.4 Costs and limits

- **CPU:** each late remote input costs a re-simulation of up to about 8 ticks inside one frame. That is fine on small and medium levels, but levels with thousands of bodies (some community levels have 2000+) will hitch. Cap the rollback window, and show a "too heavy for online" warning above a body count.
- **Players per session:** 2–4 is comfortable for P2P rollback. Beyond that, more inputs arrive late and rollbacks happen more often; a host-authoritative relay for big lobbies is a separate project.
- **Desync detection:** hash the world every N ticks and compare. The Rust port already hashes state per tick for its own checks; the game would need the same.
- **Replays and leaderboards:** a session is just every player's inputs per tick, so it can be replayed and verified offline the same way the TAS runs are.
  - P2P clients can't be trusted, so multiplayer times should stay off single-player leaderboards unless a replay is verified.
- **Mobile:** Android sessions need the same deterministic settings, and CPU headroom there is smaller.

## 5. Gamemodes and what their levels look like

New blocks would go through `EntityFactory` and the level editor like existing ones.

### 5.1 Co-op puzzle (strongest fit)

- **Mechanics:**
  - human ladders;
  - two-player pushes (heavy doors, C29-style);
  - one player holds a door or plate while the other passes;
  - a shared gravity switch that one player throws for the team;
  - big and small roles from resize: the big player pushes heavy blocks, the small one fits gaps;
  - optional rope tethers between teammates.
- **New blocks:**
  - pressure plate (active while weighted);
  - player-count door (opens with N players inside a zone);
  - team finish (every player must touch it);
  - per-player-colour gates.
- **Level shape:** short rooms with one idea each, checkpoints between rooms, and nothing that can soft-lock without a reset lever.

### 5.2 Race (collisions on)

- **Mechanics:** shared start, bumping and blocking; dynamic blocks that can be knocked into rivals' paths; bounce pads at chokepoints.
- **Level shape:**
  - wide lanes with two or three alternative routes, so one blocker can't stop the field;
  - few one-wide shafts;
  - checkpoints, so falls cost seconds rather than the race.
- Existing levels work as **ghost races** (no collisions) with a synchronized start and per-player timers. That needs no shared physics at all.

### 5.3 Versus party modes

- **Sumo / king of the hill:** push others into spikes or off platforms; a scoring zone in the middle; bounce pads and moving blocks as hazards.
- **Tag / infection:** small arenas with wall-climb surfaces, teleports and gravity flips to escape through.
- **Grapple brawl:** grapple arenas where ropes can yank loose blocks, and possibly players.
- **Level shape:** compact single-screen arenas, so one shared camera works even on one device.

## 6. Would it be fun?

**What works for it:**
- Physics-chaos co-op and party games have a proven audience: Pico Park (stacking and co-op puzzles, the closest match), Human Fall Flat, Fall Guys.
- Boxel's controls are minimal (often just jump), so anyone can join in seconds.
- The level editor means players can make multiplayer levels, which is where most party-game longevity comes from.
- Dynamic blocks, gravity flips and size changes already behave like co-op puzzle pieces.

**What works against it:**
- Boxel is a precision game. Any network delay, or a teammate's bump, ruins a precise jump, so race and versus modes must be designed to tolerate it.
- Jump-mode players can't steer away from contact, so being pushed feels unfair unless the level makes contact the point.
- Shared gravity and shared dynamic objects break most existing single-player levels.
- Griefing in a shared space; private lobbies with friends are the realistic main use.
- A shared-world mode is only as fun as its levels, and none exist yet.

**Verdict:** worth doing for **co-op puzzles** and **party race/versus on purpose-built levels**. Don't do it as "collisions on for every level". Validate the fun locally before investing in netcode.

## 7. Suggested phases

1. **Ghost races (small):** a synchronized countdown, per-player timers and results on today's ghost multiplayer. No physics coupling.
2. **Local shared world (medium):**
   - replace the `app.player` singleton with a player list;
   - route `Collision.js` effects to the touching player;
   - per-player respawn without a level reset, and a per-player or shared gravity option;
   - two players on one keyboard or controller.

   This is the cheapest way to find out whether it's fun.
3. **Rollback netcode (large):**
   - world save/restore in the game;
   - input exchange over PeerJS, about 2 ticks of input delay plus up to 8 of rollback;
   - forced deterministic settings, periodic state hashes, desync reporting.
4. **Gamemode blocks and a level pack (medium):** pressure plates, team finish, colour gates, scoring zones; editor support; 10–15 levels per mode.
5. **Extras:**
   - spectating;
   - replays of sessions;
   - bots built from the TAS solver: it already plays levels from inputs alone, and could drive ghost opponents or co-op partners for testing.
