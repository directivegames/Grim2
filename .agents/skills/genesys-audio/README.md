# genesys-audio (skill)

Guidance for playing, looping, spatializing, and mixing sound in Genesys: `SoundNode` (node-attached clips), `SoundResource` (clip definitions), and `GlobalAudioManager` (one-shot playback and the bus mixer).

## Contents

- `SKILL.md` — entry point: mental model, `SoundNode`/`SoundResource` API, asset loading, spatial vs non-spatial, volume/pitch, footguns.
- `references/one-shot-sfx.md` — `GlobalAudioManager` one-shot playback, handles, and cleanup for sounds not owned by a node.
- `references/mixing-and-filters.md` — the bus graph, custom buses, ducking, and WebAudio filter chains.
