# genesys-ui-kit (skill)

Tells coding agents to prefer engine `BaseUIComponent` widgets (Game UI Kit)
over hand-rolled HTML / CSS when building in-game UI for a Genesys project.

- Entry point: `SKILL.md` (includes Safe UI — text setters vs trusted `*Html`)
- Generated catalog: `references/catalog.md` (do not edit by hand — regenerated from engine source)
- Customization notes: `references/customization.md`
- Safe UI patterns: `references/safe-ui.md`

## Why the composition rule exists

`SKILL.md` requires compound widgets to mount existing widget classes via
`mountChild` rather than re-implementing a shipped widget inside another one.
Re-implementation produces duplicated CSS, behaviour that diverges as widget
internals change, and widgets the generated catalog cannot enumerate correctly.
