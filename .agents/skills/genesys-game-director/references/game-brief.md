# Game brief: BRIEF.md

`BRIEF.md` sits at the project root next to `GAME.md`. It holds **what the creator wants**, in their voice. `GAME.md` holds your working design and status, built from it; `TECH.md` holds how it is built. The concept check writes it ([concept-check](concept-check.md)).

A good brief pins down what drifts without it: an art target, numbers, things to avoid, and ranked priorities. Size it to the game. A brief built with your picks runs 30–50 lines; a shaped one, 50–120. A pasted brief is kept at whatever length the creator wrote.

## Template

```markdown
# <Working title> — game brief

Origin: <shaped with creator | built with my picks | pasted by creator | reconstructed from GAME.md> <YYYY-MM-DD>
Lines marked *(assumed)* were picked by the agent; everything else is the creator's.

## Pitch
<2–3 sentences: who the player is, what they do, what makes it fun. Their words first.>

## Player and play
- **Platforms** — <desktop | mobile | both>
- **Players** — <solo | online co-op | online versus>
- **Verb** — <what the player does every few seconds, and how it should feel>
- **Goal and end** — <what a run is, how it is won or lost>
- **View** — <top-down, behind the hero, side-on, first person; how big the hero is on screen, e.g. "about 6% of screen height">

## Look and feel
- **Style and mood** — <one or two sentences>
- **Setting** — <where it takes place>
- **Palette** — <5–8 colours with a word each>
- **References** — <each image or named game, and what it is for: "primary art target", "mechanics only", …>
- **Avoid** — <what it must not look or feel like, e.g. "busy textures", "realistic humans", "grimdark">

## This version
<What the first version contains, each with a number: levels or arenas, enemy types, weapons or abilities, pickups, upgrades. Add only the sections that apply.>

### Opposition
<types, how each behaves and reads, how many at once>

### Weapons and abilities
<each one: what it does and how it should feel>

### Progression
<keys, exits, currency, upgrades, unlocks>

### Levels
<how many, how they differ>

## Later, not now
- <features the creator expects to add later; the first version must leave room for them, not build them>

## Priorities
1. <what matters most; protected first when time runs short>
2. …
```

## Rules

- **The creator owns it.** Change `BRIEF.md` only when the creator changes their mind, with a dated `GAME.md` Decisions line. Never shrink it to fit what was built; record a cut in Decisions instead.
- **A pasted brief stays word for word.** Add only the *Origin* line and the image list.
- **Follow-ups are appended, never merged.** A feature the creator asks for later goes under a final `## Added later` section: one dated line each, in their words. The original text stays as it was, so a pasted brief stays word for word.
- **Mark your picks.** Every line you filled without the creator's words ends with *(assumed)*. A later session may change an *(assumed)* line when the design needs it, with a Decisions line; a creator's line changes only on their word.
- **No tool choices** (Blender, Scenario, engine classes) unless the creator stated them. Art routes come from `AGENTS.md`.
- **Read it first.** On resume and before the critic pass, read `BRIEF.md` before `GAME.md`. The critic compares the game against the brief.
