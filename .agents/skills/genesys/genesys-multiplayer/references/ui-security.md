# Multiplayer UI security

The engine replicates strings as **opaque data**. It does **not** sanitize
`playerName`, `team`, chat text, or other `@property({ replicate: true })`
fields for HTML safety.

| Source | Trust for HTML |
|--------|----------------|
| `joinParams` from clients | **Untrusted** |
| Other clients' replicated string properties | **Untrusted** |
| Server-generated display names | Treat as **display text**, not HTML |
| UI kit `label` / mustache slots | Escaped as text |
| `*Html` / `setHTML` | **Trusted markup only** (you author it) |

## Fields to watch

On `PlayerInfo` and similar: `playerName`, `team`, custom replicated strings.
Numeric scores are fine as numbers — coerce into **text** nodes, not HTML.

## Safe rendering

```ts
// ✅ Text APIs
nameSpan.textContent = playerInfo.playerName;
chat.setMessage({ name: playerName, body: messageText });
card.setTitle(playerName);
new ENGINE.NavItem(ui, { label: playerInfo.playerName });

// ✅ Trusted icons only
statBar.setIconHtml(ENGINE.Icons.shield);

// ❌ Never
el.innerHTML = `<span>${playerInfo.playerName}</span>`;
uiElement.setHTML(`<b>${playerName}</b>`);
card.setImageHtml(networkOrPlayerMarkup);
```

If you must build HTML strings, escape with `ENGINE.escapeHtml(...)` — prefer
`textContent` instead.

## Server validation (recommended, not sufficient alone)

If `GameMode` accepts a display name from `joinParams`, validate length and
character set **on the server** before assigning `PlayerInfo.playerName`.
Validation reduces abuse; it does **not** replace safe client rendering.

## Checklist

1. Inventory replicated strings used in UI.
2. Render with `textContent` or UI kit text setters.
3. Never pass replicated data to `*Html` / `setHTML` / `innerHTML`.
4. Validate client-supplied names in `GameMode` when using `joinParams`.
5. Prefer the copy-paste pattern in [player-list-safe](./player-list-safe.md).

For general HUD rules (non-network), see the **Safe UI** section in the
`genesys-ui-kit` skill and
[safe-ui.md](../../genesys-ui-kit/references/safe-ui.md).
