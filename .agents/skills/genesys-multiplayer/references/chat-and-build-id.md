# Built-in session chat and the build id

## Built-in session chat

Every multiplayer client gets an in-game text chat (bottom-left). Idle lines fade out; Enter (or the key hint) opens the composer, and touch gets a Chat button. Enter or Send sends and closes; Escape closes and discards the draft; leaving the field keeps the draft. Arrow Up/Down recalls sent lines. Typing `:fi` suggests emojis (Enter, Tab, or click inserts one; a finished `:fire:` converts on its own). Lines reach only players on the same server. Configure it; do not build a second chat on RPCs.

- Disable: `chatEnabled = false` on the GameMode (Chat category).
- Fade, scrollback, key hint: `chatFadeDelaySeconds` (`0` keeps lines), `chatVisibleLines`, `chatHistoryLines`, `chatShowKeyHint` on the GameMode.
- Emoji shortcodes: `chatEmojiShortcodes`; `false` leaves `:fire:` as text. Visual tokens (`--chat-width`, `--chat-font-size`, and the rest) live on `.ui-chat-panel`.
- Join/leave notices: `chatJoinLeaveNotices = false` silences them.
- Moderate: override `protected filterChatMessage(senderClientId, text)` on the GameMode. The relay runs on a dedicated server when `chatEnabled` is true. Return rewritten text or `null` to drop the line.
- React to lines: listen to `world.chatSystem.onServiceChanged` and subscribe to the service's `onMessage` (`ENGINE.IChatService`). Entry text is untrusted; render with `textContent`.
- The sender name comes from `PlayerInfo.playerName` on the server; clients cannot spoof it.
- Closing with Escape releases the mouse; the player clicks the game to capture it again (browsers do not let Escape re-lock the pointer).
- Voice: the engine ships no voice channel. `ChatSystem.setServiceFactory` can swap the chat service for custom middleware. Otherwise say text chat is the communication feature.

## Build id (supportability)

Show a build id in a corner of the title and pause screens on every online build, so a creator's "it broke" report names the build. It is a label, not a test mode. Keep `BUILD_ID` in `src/const.ts` and bump it per build handed to players.

Source: .engine/src/ui/components/Badge.ts, .engine/src/ui/components/BaseUIComponent.ts (`initialize`, `setPosition`); typechecked against 18.1.0-alpha.317
```ts
// src/const.ts: bump on every build you hand to players.
export const BUILD_ID = 'b07-2026-10-12';

// Title and pause screens: a small, fixed corner label.
export async function showBuildId(world: ENGINE.World): Promise<ENGINE.Badge> {
  const badge = new ENGINE.Badge(world.uiManager, { label: `build ${BUILD_ID}`, size: 'small' });
  await badge.initialize();
  badge.setPosition({ right: '12px', bottom: '12px' });
  return badge;
}
```
