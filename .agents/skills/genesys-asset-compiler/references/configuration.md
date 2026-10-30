# Asset compiler configuration

Every `assetCompiler` key in `.genesys-project`, its default, and the exclude-pattern rules. Open this before editing the config by hand.

Full shape with defaults. Omitted keys use these defaults; invalid values log a warning and fall back to the default.

Source: key shape as in `node_modules/@gnsx/genesys.js/scripts/bake-assets.ts` (`ENGINE_ASSET_COMPILER_CONFIG`) and the editor's Project Settings → Asset Compiler
```json
{
  "assetCompiler": {
    "enabled": false,
    "compileOnPlay": false,
    "compileOnOpen": false,
    "textureCompression": {
      "enabled": true,
      "quality": "medium",
      "maxSize": 2048,
      "formats": { "png": true, "jpeg": true, "webp": false },
      "exclude": []
    },
    "meshCompression": {
      "enabled": true,
      "level": "medium"
    },
    "audioCompression": {
      "enabled": true,
      "quality": "medium",
      "formats": { "wav": true, "flac": true, "aiff": true, "ogg": true, "m4a": true }
    },
    "warnExternalGlbTextures": false,
    "conversionHook": "scripts/asset-conversion-hook.mjs"
  }
}
```

| Key | Notes |
| --- | --- |
| `enabled` | Master switch. |
| `compileOnPlay` / `compileOnOpen` | See "When it runs". `compileOnOpen` is not shown in Project Settings. |
| `textureCompression.enabled` | Turns off both KTX2 compilers (loose and GLB-embedded). |
| `textureCompression.quality` | `low` / `medium` / `high`. Higher is larger and slower to encode. |
| `textureCompression.maxSize` | Longest edge in pixels before downscaling (aspect preserved). `0` keeps the original size. Applies to loose and GLB-embedded textures. |
| `textureCompression.formats` | Which **loose** texture types are baked. GLB-embedded textures ignore this. WebP is off so HTML UI images keep working. |
| `textureCompression.exclude` | Gitignore-style patterns; see below. |
| `textureCompression.binaryPath` | Optional absolute path to KTX-Software `ktx`. Otherwise `GENESYS_KTX_PATH`, the bundled copy, then `PATH`. |
| `meshCompression.enabled` | Turns off Meshopt geometry compression. |
| `meshCompression.level` | `low` / `medium` / `high`. `low` uses the smaller encoder tier; `medium` and `high` use the same higher-quality tier. |
| `audioCompression.enabled` | MP3 transcoding of loose audio. On by default inside the section, but nothing runs until the master `enabled` is `true`. Audio-only builds: master on, `textureCompression.enabled` and `meshCompression.enabled` off (SKILL.md → *Compress synth audio*). |
| `audioCompression.quality` | MP3 bitrate: `low` 96 kbps, `medium` 128 kbps, `high` 192 kbps. |
| `audioCompression.formats` | Which loose audio types are transcoded. `aiff` covers `.aif` and `.aiff`. |
| `audioCompression.binaryPath` | Optional absolute path to `ffmpeg`. Otherwise `GENESYS_FFMPEG_PATH`, then `PATH`. |
| `warnExternalGlbTextures` | Warn about GLBs that reference sidecar texture files without material overrides. Not shown in Project Settings. |
| `conversionHook` | Optional project-relative path to a JS module that decides per asset; see below. |

Edit `.genesys-project` directly or use Project Settings; both are preserved on save. After editing the file by hand, rebuild (or reopen the project) for the change to take effect.

## Excluding textures

`textureCompression.exclude` takes gitignore-style patterns matched case-insensitively against project-relative paths (`assets/...`). A string with one pattern per line is also accepted.

```json
"exclude": ["assets/ui/", "*.icon.png", "assets/hud/*", "!assets/hud/atlas.png"]
```

- A matching loose texture ships as the original file.
- A matching GLB keeps its embedded textures. Meshopt and the override strip still run on it.
- Exclusions only affect textures. Use the conversion hook to skip meshes or audio.
- Gitignore rules apply strictly: a `!` rule cannot re-include a file inside an excluded folder. `assets/ui/` followed by `!assets/ui/atlas.png` still excludes the atlas; write `assets/ui/*` instead, or use the conversion hook.

## Limitations

- **`textureCompression.formats` only affects loose textures.** To stop GLB-embedded textures from being re-encoded, exclude the GLB path or return `false` from the hook for `ktx2-texture-compression`.
- **Draco-compressed GLBs are not re-compressed by Meshopt.** Re-export without Draco to get mesh compression.

## Traps

The main traps are in [SKILL.md → Traps](../SKILL.md#traps).

- **PIE does not compile by default.** If a bake issue only shows up in shared builds, set `compileOnPlay: true` to reproduce it locally.
- **Files in `.dist/` or `.genesys/cache/` are regenerated on every build.** Edit sources and config instead.
