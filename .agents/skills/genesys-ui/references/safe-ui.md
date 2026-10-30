# Safe UI patterns

Every HUD, menu, scoreboard, and chat line follows these rules. For networked display strings, also follow `genesys-multiplayer` `references/ui-security.md`; lobbies and scoreboards copy `references/player-list-safe.md` there.

## Default: escaped text in templates

`UILayout` HTML-escapes every `{{key}}` mustache value. Labels, chat lines, and numeric strings in templates are safe as text content. Unknown keys are left unchanged (`{{missing}}` stays literal).

## Trusted HTML: `*Html` and `setHTML`

These APIs parse markup. Pass only developer-controlled strings (static SVG, `ENGINE.Icons.*`). In the engine types they carry `@remarks Trusted markup only`.

| API | Use for |
|---|---|
| `NavItem` / `Button` / `Input` — `iconHtml`, `icon`, `leadingIconHtml`, `trailingIconHtml` | Static SVG you author |
| `StatBar` / `StatCard` / `NumberDisplay` / `AbilityIcon` — `iconHtml`, `setIconHtml` | Static SVG you author |
| `ItemCard` / `WeaponCard` — `imageHtml`, `setImageHtml` | Trusted thumbnail markup |
| `UIElement.setHTML()` | Rare; full layout fragments you author |

Never pass player names, chat, RPC payloads, or `joinParams` into `*Html` setters.

## `customStyles` is trusted theming

`customStyles` runs through an allowlist (full list in [customization](customization.md)):

- Allowed: colours, borders, spacing, typography, sizing, flex helpers, `--*` custom properties.
- Blocked: overlay and stacking (`position`, offsets, `inset`, `z-index`, `pointer-events`, `transform`, `filter`, `background-image`, …).
- Values: no `;`, `{`, `}`, `url(`, or `expression(`.

It is still developer-trusted. Never feed network or player strings into it. Prefer `customClasses` + CSS for layout or full-screen effects.

## Init vs update

| Phase | Behaviour |
|---|---|
| Init | Template → DOM. User strings in mustache slots are escaped. |
| Update | Use setters that assign `textContent` or DOM properties (`setLabel`, `setTitle`, `setBody`, `setMessage`, `setText`, …). |

For trusted HTML (icons, slot scaffolding) in a subclass, inject on dedicated elements in `onInitialize()` / `onBeforeCacheElements()`, not through mustache slots.

## Dynamic user input (`Input`)

Do not put `value`, `placeholder`, `label`, or `helper` into HTML templates. `Input` binds them after mount through DOM APIs.

## Quick reference

Source: `node_modules/@gnsx/genesys.js/dist/src/ui/UIElement.d.ts`, `dist/src/ui/components/*.d.ts`.

```ts
// Safe: dynamic or networked text
nameplate.setLabel(playerName);
chat.setMessage({ name: playerName, body: messageText });
row.appendChild(document.createElement('span')).textContent = playerName;

// Safe: trusted icon
statBar.setIconHtml(ENGINE.Icons.shield);

// Unsafe: XSS when the string comes from a player or the network
el.innerHTML = `<span>${playerName}</span>`;
card.setImageHtml(userOrNetworkMarkup);
```

Custom DOM: build with `createElement` and assign dynamic strings to `textContent` or input `.value`. If you must concatenate HTML, escape with `ENGINE.escapeHtml(value)` (`.engine/src/utils/escapeHtml.ts`); text APIs are better.

Asset paths inside markup you author use `@engine/...` / `@project/...` and are resolved with `ENGINE.resolveAssetPathsInText` before injection. That is still trusted markup only.

## Checklist

1. Dynamic or networked strings → text setters or `textContent`.
2. Icons and rich markup → `ENGINE.Icons.*` or static SVG you control.
3. No player or network strings in `*Html`, `setHTML`, `innerHTML`, or `customStyles`.
4. Multiplayer lobbies and scoreboards → `genesys-multiplayer` `references/ui-security.md` and `references/player-list-safe.md`.
5. `grep -n "innerHTML\|Html(" src/ui/` lists only developer markup: the title-art holder (marked `data-title-art`, [placement](placement.md)) and `ENGINE.Icons.*`. Anything else is a finding.
6. World-space text: `TextNode` draws with canvas `fillText` and is safe for names; a `UI3DNode` widget follows the same setter rules as any widget ([world-space](world-space.md)).
