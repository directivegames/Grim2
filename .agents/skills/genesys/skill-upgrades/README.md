# skill-upgrades — Design Rationale

## Explicit cost tables rather than a formula

Stat upgrades benefit from a formula because each level is qualitatively identical — it's just a larger number. Skill upgrades represent distinct qualitative changes: level 1 fires one blast, level 2 fires three. Each level milestone is a design decision, so the cost of reaching it should be a design decision too, not an emergent consequence of a multiplier.

Explicit tables also make it easy to front-load or back-load cost spikes without distorting the rest of the curve.

## Why a fixed maxLevel

Skills represent abilities, not stats. An ability at level 3 should feel fundamentally different from level 1, which means there is a meaningful "finished" state. Unlimited skill levels would require infinitely defining new behaviour, whereas unlimited stat levels just require a larger number. The `comingSoon` mechanism lets designers ship placeholder slots for future abilities without leaving the door open for players to invest.

## Default start levels

Granting level 1 for free on a fresh save lets designers include abilities that every player should have access to immediately. The cost ladder then covers only the upgrade steps, not the initial unlock. This pattern avoids an awkward "pay to get the basic ability" moment at the start of the game.

## Combining with other skills

If using `stat-upgrades` and `skill-upgrades` in the same game, they both use currency and inventory. Rather than two separate `localStorage` keys, merge the two profile schemas into one shared store. Each skill's `assets/` file contains the minimal profile it needs — combine the fields (`statLevels`, `skillLevels`, `inventory`, `currency`) into a single profile object.
