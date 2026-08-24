# Safe UI patterns

Guidance for HUDs and menus with the Genesys UI kit. For networked display
strings, also follow the `genesys-multiplayer` skill
[`ui-security`](../../genesys-multiplayer/references/ui-security.md) reference.

## Default: escaped text in templates

`UILayout` HTML-escapes all `{{key}}` mustache values. User-facing labels,
chat lines, and numeric strings in templates are safe as text content.

Unknown keys are left unchanged (`{{missing}}` stays literal).

## Trusted HTML: `*Html` and `setHTML`

These APIs parse markup. Only pass developer-controlled strings (static
SVG, bundled icons such as `ENGINE.Icons.*`).

| API | Use for |
|-----|---------|
| `NavItem` / `Button` / `Input` — `iconHtml`, `icon` | Static SVG you author |
| `ItemCard` / `WeaponCard` — `imageHtml` | Trusted thumbnail markup |
| `UIElement.setHTML()` | Rare; full layout fragments you author |

Never pass player names, chat, RPC payloads, or `joinParams` into `*Html`
setters. Options and setters carry `@remarks Trusted markup only` in the
engine types.

## `customStyles` (trusted theming)

`customStyles` applies inline styles after an allowlist:

- Allowed: colors, borders, spacing, typography, flex helpers, `--*` custom properties
- Blocked: overlay/stacking (`position`, `z-index`, `inset`, `pointer-events`, `transform`, …)
- Values: no `;{}`, `url(`, or `expression(`

Still developer-trusted — do not feed network/player strings. Prefer
`customClasses` + CSS for layout or full-screen effects.

## Init vs update

| Phase | Behavior |
|-------|----------|
| Init | Template → DOM. User strings in mustache slots are escaped. |
| Update | Prefer setters that assign `textContent` or DOM properties (`setLabel`, `setMessage`, …). |

For trusted HTML (icons, slot scaffolding), inject on dedicated elements
in `onInitialize()` / `onBeforeCacheElements()` — not via mustache slots.

## Dynamic user input (`Input`)

Do not put `value`, `placeholder`, `label`, or `helper` in HTML templates.
`Input` binds them after mount via DOM APIs.

## Quick reference

```ts
// ✅ Text from gameplay or network
component.setLabel(playerName);
element.textContent = message;

// ✅ Trusted icon
statBar.setIconHtml(ENGINE.Icons.shield);

// ❌ Untrusted HTML
element.innerHTML = `<span>${playerName}</span>`;
card.setImageHtml(userProvidedMarkup);
```

When building custom DOM, use `createElement` and assign dynamic strings to
`textContent` or input `.value`. If you must concatenate HTML, escape with
`ENGINE.escapeHtml(...)` — prefer text APIs instead.

## Checklist

1. Dynamic / networked strings → text setters or `textContent`.
2. Icons / rich markup → `ENGINE.Icons.*` or static SVG you control.
3. No player/network strings in `*Html`, `setHTML`, `innerHTML`, or `customStyles`.
4. Multiplayer lobbies / scoreboards → also read multiplayer `ui-security.md`
   and copy [player-list-safe.md](../../genesys-multiplayer/references/player-list-safe.md).
