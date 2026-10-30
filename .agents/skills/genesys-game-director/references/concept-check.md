# Concept check and the game brief (step 0)

Every new whole build starts from a **game brief**: `BRIEF.md` at the project root, the creator's intent in their voice (template: [game-brief](game-brief.md)). How it gets written depends on the prompt and on the creator's choice:

| Prompt | Do |
|---|---|
| A **full brief** (pasted or typed; passes the test below) | Save it word for word as `BRIEF.md`. No gate. Build. |
| **Anything less** — "make a game", a genre, or a paragraph like "a ball rolling down a suburban street, collect stars, avoid cars" | **The gate:** build it now, or shape it together first. |

**Full-brief test.** A prompt is a full brief only when it names all four:
1. **The verb** — what the player does most of the time.
2. **The end** — how a run is lost, won or completed (a timer, a finish line, health, levels solved).
3. **The look** — an art style, a camera, or a reference image.
4. **The content** — what this version holds: levels, courses, enemies, a level file.

If one is missing, run the gate, even for a long prompt. Record the result in `GAME.md` → **Status → Concept** (*Records*, below), with the missing item after a gate: `built with my picks — missing the end`. Length does not count: a 100-word prompt with an image can pass, and a 400-word pitch with no end does not.

Field note: a structured brief with an art-target image, numbers, things to avoid and ranked priorities produced the most complete game these skills have built. A one-line prompt with only genre defaults produces a working but generic one. The shaping round exists to close that gap for creators who want to.

## When it runs

On a **new whole build** with no `BRIEF.md`. The files on disk tell a fresh session whether this step is already done, so read `BRIEF.md` and `GAME.md` first, then decide which case the prompt is:

| Prompt, in a folder that… | Do |
|---|---|
| …is empty, or holds only the empty template | **New game.** Run the gate (below), unless the prompt is a full brief or says to skip questions. |
| …holds a **starter template** (a genre template such as FPS, platformer or vehicle: its own GameMode, pawn, systems, level and assets, but no `BRIEF.md` or `GAME.md`) | **New game on a template.** Never ask *new project* or *replace here*: a template is a starting point, not a game. Run the gate as for a new game, with the template plan in the pitch (*Starter templates*, below). This holds for any genre, also one the template was not made for. |
| …has `BRIEF.md`, and the prompt continues that game (a resumed session, "keep going", a fix) | **Resume.** Read `BRIEF.md` and follow it. No gate. |
| …has `BRIEF.md`, and the prompt names a new feature for that game ("add a boss rush mode", "a second level", "make it online") | **Follow-up.** No gate. The creator named it, so it is in scope: append it to `BRIEF.md` under **Added later** in their words, add it to `GAME.md` → **Requested outcome**, write a dated Decisions line, then build it (step by step for one feature, whole build for several systems). |
| …has a `GAME.md` Design but no `BRIEF.md` (a game started before briefs) | **Resume, and reconstruct the brief.** No questions. Write `BRIEF.md` with `Origin: reconstructed from GAME.md <date>`: copy **Requested outcome** and the creator's redirects from **Decisions** as their words, and mark every other line *(assumed)*. Then continue from **Now**. |
| …holds a game, and the prompt asks for a **different** game (another genre or fantasy than `BRIEF.md` / the `GAME.md` Fantasy, or "new game", "start over", "make something else") | **New game in an occupied folder.** Never treat it as a follow-up and never build it on top of the old brief. Ask one question: **Start it in a new project** (recommended; the creator creates the project in the editor, and you leave this one untouched) / **Replace the game here**. On *replace*: move the old `BRIEF.md`, `GAME.md` and `TECH.md` to `archive/<YYYY-MM-DD>-<old title>/`, show the scene inventory and ask before clearing anything (*Check once, then go*), then run the gate for the new game. |

When you can't tell whether the prompt continues the game or starts another, ask that one question; it is the real product fork. Also skip the gate when the working mode is focused change or step by step, or when the prompt says to skip questions ("just build", "surprise me", "no questions", "your call", "don't ask"): write `BRIEF.md` from your picks, as for **Build it now**.

## A full brief

Save the creator's text unchanged as `BRIEF.md`, with an *Origin* line at the top (`pasted by creator <date>`) and a list of attached images and what each is for. When a product fork is still open (no platform, solo or online), ask that one question with your recommended answer, and keep building while it is open. Never rewrite or summarise a pasted brief; `GAME.md` holds your working interpretation.

## Starter templates

A starter template is the creator's starting point. Treat its code, scene and assets as material to build on, not as another game.

1. **Inventory it, read-only, in the same turn as the gate.**
   - Find the template's files. Run `git rev-list --max-parents=0 HEAD` to find the first commit, then `git show --name-only --format= <commit>` to list its files. With no git history, or with several first commits, treat every file the pack did not write as template.
   - List its systems: the GameMode, pawn and controller, weapons or abilities, enemies, UI screens, level and asset folders.
   - Read the notes it left in the custom section of `AGENTS.md` (below `# GENESYS-SDK-END`). If a note conflicts with these skills, follow the skills and tell the creator once.
2. **Plan each system: keep, extend or replace.**
   - If the prompt fits the template's genre, keep and extend its systems (its pawn, weapons, level).
   - Replace a system only when the prompt needs something it cannot do. Engine first still holds: prefer the template's working system over a new one.
   - A prompt in another genre replaces most systems. Keep what still fits (camera, input, screens).
3. **Put the plan in the gate.**
   - Add one line to the 3–4 line pitch: "I'll build on the template's <kept systems> and replace <replaced systems>."
   - If the plan deletes or moves template files or scene nodes, name them by system ("the template's enemies, weapons and level"). A system's name covers its files and nodes.
   - The answer to the gate approves the plan. If the interview changes the plan, show the new plan line with the brief summary; **Build this** approves it.
4. **Record the plan** in `GAME.md` → Decisions: `template plan: keep <…>; extend <…>; replace <…>; delete <…>`. Give every kept system a `reuse` Assets row or a `Lane` line.
5. **Build.** Edit and extend template files and scene nodes without asking. Delete or move only what the recorded plan names. A template file the creator changed is the creator's: ask before you overwrite it. A resumed session follows the recorded plan.

**Full brief on a template.** No gate runs, so nothing approves deletions yet. State the plan in one line and build with keep and extend. If the plan deletes or moves template files or scene nodes, that list is the one question you may ask (merge any open product fork into it). Keep building the rest while it is open.

## The gate

One question, in the same turn as the read-only checks of *Check once, then go* (MCP probe, art routes, scene inventory). Make no code, scene or asset changes until the creator answers.

First show the game you would make, in 3–4 lines built on the creator's own words: the pitch, what the player does, how a run ends, the look, and the hook you would add (from [genre-defaults](genre-defaults.md)). For an empty prompt, pick a genre too.

Ask it where the creator is talking (*Where to ask*, below). Two options, the recommended one first:

- **Build it now** — "I'll build the game above; you can redirect it as it comes together." Recommend it when the prompt already says what the player does and how a run ends.
- **Shape it together first** — "A few quick questions so the game matches what you have in mind." Recommend it when the prompt is only a genre, a mood, or nothing.

Answers:
- **Build it now**, or free text with no design in it ("go", "sure") → write a short `BRIEF.md` (Origin: `built with my picks`; your picks marked *(assumed)*), tell the creator in one line that it is there and they can edit it, then build. No approval wait.
- **Shape it together first** → the interview below.
- Free text that adds design ("make it underwater") → fold it into your picks and ask the gate again in one line, or start the interview if they asked for one.

## Where to ask

Ask in the conversation the creator's prompt came from. Every question in this file follows this order:

1. **Your chat client's own question tool** (for example `AskUserQuestion` in Claude Code). It shows the options in the chat the creator is reading.
2. **The editor's `request_user_input`** only when you are the editor's built-in assistant: the prompt was typed in Sandbox Studio's own chat. When the editor is only connected to you over MCP, its dialog opens in the editor window, where nobody may be looking.
3. **Plain chat** otherwise: the numbered options in one message, then end the turn.

A question that times out or comes back unanswered is asked **once** in plain chat, then the turn ends. Never retry the same dialog. Field note: a gate sent to the editor dialog from a Claude Code session timed out unseen before the agent asked in chat.

**Fit every tool.** At most 3 questions per call, each with 2–3 options; the tools add a free-text answer themselves, so never add an "Other" option. Ask for reference images in the message text around the questions ("drop in an image if you have one"), not as an option.

## The interview

Talk like a game designer meeting a client: start broad, let each answer choose the next questions, and finish with the look and the priorities. Four stages; each stage is **one** question call (*Where to ask*) with at most 3 questions. Skip any question the prompt or an earlier answer already settled.

| Stage | Ask about | Example questions |
|---|---|---|
| **1. Core** | Genre or fantasy · what the player does · who plays where (platforms and solo or online, as one question) | "What kind of game?" · "What do you do most of the time?" · "Who plays, and where?" (solo on desktop and phone / solo desktop only / online with friends) |
| **2. This genre** | The questions that shape *this* genre (table below) | Shooter: "What do you fight?" · Racer: "What do you race?" |
| **3. Look and feel** | Art style and mood · setting · view (top-down, behind the hero, side-on, first person); reference images asked in the message text | "What's the vibe?" · "Where does it take place?" · "How do we see it?" — plus "drop in a reference image if you have one" |
| **4. Scope and priorities** | How big the first version is · what matters most; "what to add later" invited in the message text | "How much in the first version?" · "If we can only nail one thing, which?" — plus "tell me anything you want to add later" |

Each question:
- has 2–3 concrete options that fit everything already settled, the recommended one first; an unanswered question or "you decide" takes the recommended option, marked *(assumed)*;
- is about the game the player experiences. Never ask about HUD layout, pause, health numbers, key bindings, menus, engine classes, or art routes (`AGENTS.md` sets those). Those stay your decisions from the genre defaults;
- accepts free text; the creator can always type their own answer.

**Stage 2 by genre.** Pick the family from stage 1 (combine two for a hybrid):

| Family | Ask about |
|---|---|
| Shooter / action / brawler | Enemies (what, how many kinds) · weapons or powers · objective beyond survive (keys, exit, boss, waves) |
| Platformer / runner | How the hero moves (jump style, special move) · hazards · what a level is (fixed levels, endless) |
| Racer / vehicle | What is driven · track or open area · rivals (AI racers, time trial, ghost) |
| Puzzle | The core rule · how a level is won · how difficulty grows |
| Survival / horror | The threat · resources (food, light, ammo) · how a run ends |
| Sports / physics toy | The sport or toy · scoring · opponent (AI, friend, score attack) |
| Cozy / sandbox / sim | The activity · what grows or unlocks · whether anything can fail |
| Strategy / tower defence | Units or towers · the enemy's path · economy |

**Escape.** At any point "just build it", "go", or "you pick the rest" ends the interview: fill the rest with your picks marked *(assumed)* and continue to the brief. Do not re-score the prompt between stages; the interview runs all four stages unless the creator stops it.

## Approve the brief

Write `BRIEF.md` from the answers ([game-brief](game-brief.md)). Show it in the chat as a summary of 10–15 lines: the pitch, the player and play, look and feel, scope, priorities, with *(assumed)* on your picks. Say the full brief is in `BRIEF.md`. Then ask one question: **Build this** (recommended) / **Change something**. "Change something" → edit `BRIEF.md`, show only the changed lines, and ask again.

## Record it

- `BRIEF.md` carries the *Origin* line and marks every line you picked *(assumed)*. Everything else is the creator's.
- `GAME.md` → **Status → Concept**: `full brief`, `built with my picks`, `shaped with creator`, or `skipped — <why>`.
- `GAME.md` → **Decisions**: one dated line for the gate outcome and one for the approved brief. Later changes to the brief also get a dated line.
- The Design bullets in `GAME.md` are your working version of the brief. Where they differ, the brief wins, unless a Decisions line records the creator changing it.

## Traps

| Observed | Fix |
|---|---|
| A short paragraph prompt was built without the gate | Only a full brief skips it. Ask build now or shape it. |
| A prompt for a different game was built on top of the old game's brief and scene | A different genre or fantasy is a new game: ask new project or replace, archive the old docs, and run the gate. |
| A resumed game with no `BRIEF.md` lost the creator's original words | Reconstruct `BRIEF.md` from `GAME.md` → Requested outcome and Decisions, marked `reconstructed`. |
| The interview stopped after two answers and started building | Run all four stages unless the creator says "just build it". Never re-score in between. |
| Stage 2 asked the same questions for every genre | Use the stage-2 row for the genre the creator picked. |
| No question about the look or reference images | Stage 3 always asks for style, setting, view and a reference image. |
| A question asked about HUD, health or key bindings | Ask about the game the player experiences; decide the plumbing. |
| The question went to the editor dialog while the creator was in another chat, and timed out | Ask in the creator's chat (*Where to ask*); after a timeout, ask once in plain chat. |
| A question call was rejected or cut short | At most 3 questions, 2–3 options each, no "Other" option. |
| A pasted brief was rewritten or shortened in `BRIEF.md` | Save it word for word; interpret in `GAME.md`. |
| Code or editor changes started before the gate or the approval was answered | Only read-only checks run while a question is open. |
