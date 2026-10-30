---
name: genesys-player-accounts
description: Player login for a published Genesys game — anonymous play, create account, sign in, keep progress, leaderboards, and purchases that need a logged-in player. Use when the game should read the current player, open the host account panel, or when saved progress or multiplayer should turn on Show Sign-in Bar.
metadata:
  tokens: 1136
---

# Player accounts

Published games (`/play/{gameId}`) give the player an anonymous account the first time the game reads it (or the player opens the host Account panel). Page load alone does not create one. The game never collects an email or password. When a feature needs a lasting identity, ask the play host to open its account panel. The host popup is the only place credentials are entered.

Confirm signatures in `.engine/src/play/genesys-play-shell.ts` before writing calls.

## When to ask

Ask only at the interaction that needs a registered player: buying, submitting a score, saving progress that must survive a new browser. Do not block the rest of the game, and do not put an account button in the HUD unless the creator asked for one.

When the game saves progress that must survive a new browser, or the game is multiplayer, turn **Show Sign-in Bar** on in Project Settings and republish, unless the game already has its own account UI.

Editor play and local play have no player account. Treat that as "this session cannot sign in" and let the feature no-op or run without persistence.

## Read, then request

Import the engine as `import * as ENGINE from '@gnsx/genesys.js'`.

```ts
const account = await ENGINE.readGenesysPlayerAccount();
if (account.status === 'registered') {
  // account.playerId is stable. Use it as the player key.
  return;
}
if (account.status === 'anonymous') {
  ENGINE.requestGenesysPlayerAccountLogin();
}
```

| `status` | Meaning |
| --- | --- |
| `registered` | Signed-in account. `playerId` and `displayName` are set. |
| `anonymous` | Guest for this browser. The first connected Sandbox account adopts this `playerId`. |
| `unavailable` | No host account (editor play, local play, an older host, blocked cookies, or the host is down). Do not open UI. |
| `unknown` | Host has not finished the first read. Read again; do not treat it as signed out. |

`requestGenesysPlayerAccountLogin()` opens the host panel only for `anonymous`. It returns immediately and does nothing for `registered` or `unavailable`. The popup explains the transition, then opens the standard Sandbox page for sign-in or registration.

The first Sandbox account that has no Genesys player mapping adopts the current guest `playerId`. A known account resumes its existing `playerId` and leaves the current guest progress behind. Key saved data by `playerId` from the first read so the host can preserve it without copying game data.

`requestGenesysPlayerAccountUpgrade()` remains as a deprecated alias.

## Matchmaking identity

Do not set a player id or an auth token on the host matchmaking client. Published play sends a ticket for the player cookie. Editor and local play use the editor session, and a signed-out request fails with `Sign in to use matchmaking`.

A client that calls the matchmaker itself can use `ENGINE.createGenesysMatchmakingAuthTokenProvider()`. Null (editor play, local play, an older host) means send the development `dev:<playerId>` header, which only a local matchmaker accepts. Cloud play throws when it cannot issue a ticket. Do not cache or forward the ticket yourself.

The game's copy of `account` goes stale after the popup. On the next attempt of the same action, call `readGenesysPlayerAccount()` again. Do not poll.

## Log out

Use the host API for a custom logout button:

```ts
const guest = await ENGINE.logoutGenesysPlayerAccount();
```

Logout clears only the in-game session, not the shared Sandbox/editor SSO session, and immediately returns a fresh anonymous player. The old account and its progress remain intact. Hosts older than the logout API return `unavailable`.

## Rules

- Never build an email or password form, and never read or store tokens, cookies, or the account email. The claims are `playerId` and `displayName` only.
- `playerId` is the identity key. `displayName` is a label, not a login.
- If `status` is `unavailable`, skip the gated action. Do not show an error that tells the player to sign in.
- Do not call the play HTTP routes from game code. The host owns the session.

## Host Sign-in bar

Project Settings has **Show Sign-in Bar** (`showPlayerAccountButton` in the project file). It is off unless the creator turns it on, and a published game shows it only after the next publish. Guests see a bar at the top of the game: **Sign In** opens Sandbox login, and dismiss hides the bar for that visit. Signed-in players see their name and can log out from that pill. Turn the setting on when the game saves progress that must survive a new browser, or when the game is multiplayer. Leave it off when the game supplies its own account UI. Do not add a separate account control to the HUD. Turning the setting on does not change the API above.
