# Genre defaults

Use these when the pitch is short. Take the closest row, change only what the creator already said, and write the result into `GAME.md` **Design** as decisions. When two rows fit, such as "zombie racing", combine them: the verb comes from one, the pressure from the other.

Every row also gets the common bar:
- title → play → pause → result → retry;
- a music bed;
- two feedback channels on the main action and the main hit;
- real models on the hero and the opposition;
- a 2–5 minute target run unless the genre is endless or a sandbox;
- touch controls for the main verbs plus a tappable pause when a touch recipe fits (`genesys-touch-controls`), or one line saying why not;
- tuning numbers in `src/const.ts`;
- the hero pawn from `genesys-engine` (solo hero that fires or interacts: `DefaultCharacterPawn` + `DefaultPlayerController`).

Class names point at the owning skill. That skill has the API.

## Action

### Top-down / twin-stick shooter
- **Camera:** follow from above, pitched 50–70° so models read. Not an RTS pan (`genesys-camera`).
- **Controls:** WASD moves in screen space, the mouse aims, hold left button to fire, Esc pauses. Cursor visible; it is the reticle.
- **Loop:** waves of enemies that chase or shoot. Health. Score per kill. Health 0 → result.
- **Pacing:** first enemy within 3 s. Wave size or speed rises every 30–45 s.
- **Feedback:** muzzle, visible projectile travel, impact, death burst, screen-relative hit flash.

### First-person shooter
- **Camera:** eye height. Pointer lock while playing, cursor on menus (`genesys-camera`).
- **Controls:** WASD, mouse look, click to fire, R reload if there is ammo, Esc pauses.
- **Loop:** enemies that take cover or advance and shoot back. Health. Score or a room-clear goal. Death → result.
- **Space:** a small arena or a few rooms, with cover the player can read.
- **Hero:** the weapon view model on the spawned pawn.

### Third-person action / brawler
- **Camera:** spring-arm follow at 4–6 m, collision pull-in.
- **Controls:** WASD relative to the camera, mouse orbit, click for attack, Space dodge or jump.
- **Loop:** melee or ranged enemies in waves or encounters. Health. Clear the area or survive. Death → result.
- **Feedback:** hitstop 40–60 ms on hits, knockback, hit flash (recipes: `genesys-game-feel`; character knockback: `genesys-movement`).

### Platformer (3D or side-on)
- **Camera:** side-on or behind, following, with the pawn always in frame.
- **Controls:** move, jump (variable height), and one action (dash, double jump, or stomp).
- **Loop:** hazards and simple enemies. Lives or health. Reach the goal, or collect N. A fall or a hit costs a life → respawn at a checkpoint. 0 lives → result.
- **Space:** a short course with a gap, a moving platform, and a checkpoint. Teach, then test.
- **Feel:** coyote time, a jump buffer, variable jump height and a faster fall (recipes in `genesys-movement`); jump and land each have a sound.

### Endless runner
- **Camera:** behind or side-on, fixed offset.
- **Controls:** lane change or jump/slide only.
- **Loop:** obstacles stream in and speed rises over time. One hit ends the run. Score = distance plus pickups.
- **Retry:** instant, with no reload.

## Driving and flying

### Arcade racer
- **Camera:** chase cam with slight lag, FOV kick on boost (`genesys-vehicles`).
- **Controls:** W/S throttle and brake, A/D steer, Space drift (the stock handbrake stops all wheels, so arcade racers map Space to drift), Shift boost, R reset to track.
- **Loop:** 3 laps against AI or a ghost, or checkpoints against a clock. Lap times and position in the HUD. Finish → result with time and rank. Laps, ordered checkpoints, AI racers, drift and boost: `genesys-vehicles` → racing.
- **Space:** a closed track with clear edges; walls or a kill-respawn volume.

### Flight / arcade flyer
- **Camera:** chase from behind and above.
- **Controls:** WASD pitch and roll (or mouse steer), click fire if combat. Throttle: `AirplaneMovementNode` reads it from the zoom input and starts at `initialThrottle` 0; set a cruising `initialThrottle` and bind Shift/Ctrl as described in `genesys-movement`, or the plane crawls at minimum speed.
- **Loop:** rings, targets, or dogfight enemies against a clock or health.

### Launch and glide / distance-upgrade
For "launch it as far as you can, earn coins, upgrade" games (paper plane, catapult, cannon, ski jump).
- **Space:** one enclosed, readable place (a garden, a valley, a beach), sized to modest early distances. Not an endless strip: distance comes from steering around the space, and the space ends in a soft boundary.
- **Launch:** a pull-back-and-release on a fixed launcher (ramp, runway, catapult). Pull distance = power; sideways = aim. Read the reference for the launcher's form.
- **Flight:** unpowered and forgiving: energy bleeds through drag, pulling up trades speed for height, stall drops the nose gently. Arcade first; the creator tunes it in `src/const.ts`.
- **Run end:** contact with an obstacle or the ground ends the run after a short beat; the camera rises to an overview with distance, coins and best.
- **Progression:** coins buy small upgrade steps; every Nth step upgrades the vehicle visibly (colour, stats). Save in `localStorage` (`genesys-game-boot`).
- **Retry:** "Again" goes straight back to the launcher; "Upgrade" goes to the title/upgrade screen.

## Survival, strategy, puzzle

### Wave survival (zombies, monsters)
- **Camera:** top-down or third-person, whichever the pitch implies. Default to third person.
- **Loop:** escalating waves of walkers (navmesh, `genesys-creatures`), health, pickups between waves. Survive N waves, or as long as you can.

### Tower defense
- **Camera:** angled overhead with pan and zoom (`genesys-camera`).
- **Controls:** click a slot to build, a currency HUD, a "next wave" button.
- **Loop:** enemies follow a path. Towers auto-fire. Leaked enemies cost lives. Clear N waves → win. 0 lives → result.

### Puzzle (physics, sokoban, match)
- **Camera:** fixed or gently orbiting, framing the whole puzzle.
- **Loop:** a sequence of 3–5 short levels that rise in difficulty. A move counter or timer. Undo/restart is one key.
- **Pressure:** a move or time limit, or none for a relaxed puzzle; say which.
- **Result:** after each level, with Next and Retry.

## Calm and social

### Collect / explore / cozy
- **Camera:** third-person follow.
- **Loop:** collect N items or complete small tasks in a pleasant space. A soft timer or none. The end screen celebrates completion.
- **Pressure:** optional and gentle (a day timer, hunger); write "none" if relaxed.

### Sports / party mini-game
- **Camera:** broadcast-style fixed or follow.
- **Loop:** a short match (90–180 s) against AI. Score HUD with a clock. Match end → result with Rematch.

### Upgrade loop (incremental, idle-adjacent)
For "earn, buy upgrades, go again" games where the run is short and the meta-loop is the point.
- **Loop:** a 10–60 s run that earns currency; a title/shop screen between runs; each purchase changes a number the player feels in the next run.
- **Pacing:** the first upgrade is affordable after 1–2 runs; costs grow about 1.3–1.6× per step.
- **Store boundary:** in-game currency only, unless the creator asks for the real store (`monetization-store`).

## No row fits

Fill the same fields yourself in one pass: camera, controls, loop (verb, pressure, goal, end), space, pacing, feedback, and hero. Do not leave any of them as a question for the creator.
