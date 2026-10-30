# Brief template: the fresh critic

A critic is a fresh worker that judges the game from evidence, not from the builder's account. Run it on a whole build as soon as the **first passing run's** in-Play captures and smoke log exist (`genesys-verification` → *Fresh critic*): the first run whose loop steps pass, even if smaller FAILs remain. Start it in the background and keep working the remaining fix re-checks while it reads; do not wait for a clean run. It costs one short worker run and catches what the builder stopped seeing: a level that reads as a strip, a hero that is still a capsule, a HUD covering the action, a launcher that doesn't match the reference.

Why it works: it starts with no history in the build, so it has nothing to justify. It writes defects in the shared [defect codes](../../genesys-verification/references/defect-codes.md), each with a weight and a capture, and never a score or grade (any number invites rounding up). And it writes down what already works, so the next round of fixes doesn't quietly undo it.

Fill the angle-bracket fields and send it as one task. Read-only; any model tier that can view images works.

```text
You are reviewing a Genesys game at <absolute project root>. Someone else built it; you are seeing it for the first time, through its files only. Change nothing: no file edits, no MCP calls, no builds, no generation, no subagents.

Read, in this order:
1. BRIEF.md — what the creator asked for: Look and feel (especially Avoid), This version, Priorities.
2. GAME.md — Design (especially Reference read, Space, Camera, Art direction), Done when, Assets, Scope, Keep list.
3. .agents/skills/genesys-verification/references/defect-codes.md — the only names you use for defects.
4. Every image in .scratch/play/ (in-Play captures) and .scratch/captures/ (editor captures). Open each with the file-reading tool.
5. The model screenshots in .scratch/captures/ for the hero, the opposition and the props the player handles or gets close to. When Blender is on, also the contact sheets in .scratch/blender/.
6. The latest smoke log: <path or pasted [SMOKE] lines>.
<7. Reference images the creator supplied: <paths>.>

Do not read the builder's summary or the chat.

Judge the game against BRIEF.md (its Priorities first), GAME.md and the references as a player would see it from the gameplay camera:
- Does the play space match the Reference read (shape, size, what bounds it)?
- Does every Assets row with status wired look like the thing it is in a capture?
- Is the hero in frame on the title, and does the HUD keep to the corners and stay readable?
- Does the UI follow the UI direction in GAME.md (fonts, shape language, signature element), or does it look like the default widget kit?
- Does anything in the captures contradict a Done-when row, a Decisions line or a Keep-list item?
- Numbers in the smoke log come from the game itself. When a number and a capture disagree, believe the capture.

Weights: breaks = the loop doesn't work, or the game isn't recognisably what the brief describes; noticed = obvious within a minute of playing; polish = everything else.
A defect is something BRIEF.md or GAME.md asked for that the evidence doesn't show. A feature nobody asked for (a new mode, system or mechanic) is never a defect: list it under EXTRAS. More of what was asked for (detail in the described space, a stronger version of the named pressure) counts as a defect only when the brief's Look and feel asks for it.
When the evidence can't settle a question, put it under UNMEASURED with what would settle it. Never assume a pass.

Return exactly:
DEFECTS:
- <weight> <code> <what, in one line> — <capture file> — fix in: <skill from the code table>
  (at most 8 lines, breaks first; "none" if none)
GAP: <the single biggest difference between this game and what was asked for, in one sentence, as a player would put it>
KEEP:
- <something that works now and a fix could break, with the capture that shows it>
  (at most 8 lines; repeat earlier KEEP lines that still hold)
EXTRAS: <features beyond the brief, one per line, or "none">
UNMEASURED: <questions the evidence couldn't settle, or "none">
```

## What the parent does with it

1. Fix every `breaks` and `noticed` defect in **one batch**, each in the skill the code names, together with any art or lighting notes held back from the smoke runs. Never re-run after a single defect. Fix a `polish` item only when it is cheap; otherwise note it in `GAME.md` **Now** as known polish.
2. Merge **KEEP** into the `GAME.md` **Keep list** (at most 8 items; when full, drop the least important). Every later worker brief and every later critic reads it.
3. Put each **EXTRAS** line under `GAME.md` **Scope** → *Proposed* and ask the creator about it once, in one line, at the next handoff. Build none without a yes (`genesys-game-director` → *Never grow it silently either*).
4. Run **exactly one** full smoke re-run for the whole batch (`genesys-verification` → *Budget*). Run a second round with a **new** critic only if this round found a `breaks` defect. Stop after that round, or when the creator changes direction.
5. When a code turns up in two rounds, add a smoke step or scene scan that measures it (`genesys-verification`).
