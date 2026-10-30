# When buildProject fails

The short version is in [SKILL.md → When buildProject fails](../SKILL.md#when-buildproject-fails). Each row ends in a rerun of the canonical build sequence from the step it names.

| Symptom | Cause | Fix |
|---|---|---|
| `ok: false`, or errors after the build | Compile or bundle error | `query_diagnostics(getBuildErrors)`; fix the first error; rerun from step 1 |
| A build error names a missing `@project/assets/...` file | Code references an asset that is not made yet (title still, icon) | Step 2 names it. Make the asset first, or drop the literal until it lands. |
| `editor_busy` | Another build, Play transition, or scene save ran past the 30 s the call waits for it | Wait for `query_editor(getBusyState)` to clear, then retry **once**. Never retry in a loop. |
| Build ok, but the bundle grep is 0, or Play shows the old game | Stale `.dist`, or the GameMode is not reachable from `main()` | Check that `defaultGameModeClass` names your class and its file is imported; rebuild; grep again |
| GameMode is in the bundle, but `getRegisteredClasses` is empty | Classes not loaded yet, or a missing `@ENGINE.GameClass()` | Add the decorator; rebuild; query again |
| A class was renamed, and Play errors on the old name | Stale `auto-imports.ts`, or a scene or prefab still points to `GAME.<OldName>` | Rebuild (it regenerates `auto-imports.ts`; never edit that file). Find leftover nodes with `query_node`, fix them through MCP, `action_scene(save)`. |
