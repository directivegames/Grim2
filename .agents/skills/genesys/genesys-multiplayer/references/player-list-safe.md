# Canonical example — safe player list

Copy this pattern for lobbies, scoreboards, and any HUD that shows
`PlayerInfo.playerName` (or other replicated strings).

Reference implementation: engine `demos/examples/client-server-demo/game_loop.ts`
(`updatePlayerList`).

```ts
import * as ENGINE from '@gnsx/genesys.js';

function updatePlayerList(
  contentDiv: HTMLElement,
  world: ENGINE.World,
): void {
  const playerInfoActors = world.getActors(ENGINE.PlayerInfo);
  contentDiv.replaceChildren();

  if (playerInfoActors.length === 0) {
    const empty = document.createElement('span');
    empty.textContent = 'No players connected';
    contentDiv.appendChild(empty);
    return;
  }

  const localClientId = world.netWorld?.clientId;

  for (const playerInfo of playerInfoActors) {
    const name = playerInfo.playerName || 'Unknown';
    const isLocal = playerInfo.clientId === localClientId;

    const row = document.createElement('div');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name; // ✅ replicated string as text
    row.appendChild(nameSpan);

    if (isLocal) {
      const you = document.createElement('span');
      you.textContent = ' [YOU]';
      row.appendChild(you);
    }

    contentDiv.appendChild(row);
  }
}
```

## Prefer UI kit text APIs when a widget fits

```ts
nav.setLabel(playerInfo.playerName);
chat.setMessage({ name: playerName, body: messageText });
```

## Avoid

```ts
// ❌ XSS if name is player- or network-controlled
contentDiv.innerHTML = `<div>${playerInfo.playerName}</div>`;
uiElement.setHTML(`<b>${playerName}</b>`);
```

Static icons still use trusted markup: `setIconHtml(ENGINE.Icons.shield)`.

See also: [ui-security](./ui-security.md), genesys-ui-kit [safe-ui](../../genesys-ui-kit/references/safe-ui.md).
