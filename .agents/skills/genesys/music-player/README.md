# music-player — Rationale

## Why pitch-shift instead of mute during slomo

Muting or cutting the music when slomo activates breaks immersion — the sudden silence is jarring. Pitching down to 0.42× preserves the mood and rhythm of the track while signalling "time has slowed." The rate 0.42 was chosen so the music stays above the threshold where it sounds like abstract noise (roughly 0.3×) but clearly differs from 1.0×.

## Why 0.42× and not 0.12× (the full game slomo rate)

At 0.12× even a well-produced track becomes an unintelligible drone. The gentle 0.42× feels slow without destroying the melodic content. The music is a separate experience from the physics — it does not need to match game time exactly.

## Why lerp with wall-clock time

Using scaled (slomo) delta time would mean the rate transition itself slows during slomo, making the pitch shift take many real seconds to complete. Wall-clock time (`realDt = scaledDt / slomo`) keeps the lerp at a consistent ~0.12 s regardless of how deep the slomo is.

## Why a separate actor per music context

A single music actor that switches tracks requires pausing, loading, and resuming — which introduces gaps. Separate actors can be pre-created with their tracks loaded, so a context transition is just `outgoing.stop(); incoming.start()` with no load stall.

## Why the Music bus

Using `bus: 'Music'` separates music routing from SFX in the engine's audio graph. A user can have separate music and SFX volume sliders without the music actor needing to know about SFX, and vice versa. The `applyMusicVolumeToAll` helper further decouples the volume control from any specific actor reference.
