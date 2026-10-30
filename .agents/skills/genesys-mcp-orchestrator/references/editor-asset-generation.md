# Editor asset generation (`action_asset_generation`)

Generated art for a game goes through `genesys-generated-assets` (Scenario MCP). Open this file only when the user explicitly asks to use the editor's own generator (the title-bar Foundry dialog and its MCP tool), or when `genesys-generated-assets` sends you here. The cost rules are the same: price with a dry run and ask before any paid run.

In the Genesys editor, a Scenario tool result that contains an asset id shows the Scenario viewer on its own (a `model_run` that only returns a job id does not). Do not call `asset_display` just to preview it there; other clients show the asset by calling `asset_display` with that id.

Follow the `genesys-mcp-orchestrator` gate and readiness check first. `action_asset_generation` and `query_asset_generation` are compact routers; call them directly.

## Generate a skybox

Ask before spending credits. A dry-run does not start a job.

```text
→ action_asset_generation(action="start", kind="skybox", prompt="…", dryRun=true)
→ action_asset_generation(action="start", kind="skybox", prompt="…", waitMs=30000)
→ query_asset_generation(operation="getStatus", generationId=…, waitMs=45000) until status is saved or failed
→ action_asset_generation(action="apply", generationId=…)
```

- Warn the user when the saved record has `isHdr: false` (the file is an LDR panorama).
- The skybox is converted to an HDRI by default. Pass `options={ "hdr": false }` only when the user wants the LDR panorama; it skips that job and its credits.
- Do not call `start` again to retry a failure. Another start spends credits.
- If the user asks to stop, call `action_asset_generation` with `action: "cancel"`. Cancel does not need approval. Scenario may still charge for the job. `getStatus` can return `canceled`, or `failed` with `error: "interrupted"` after the app restarts before the job id was stored.

## Upscale, remove a background, or convert an asset

Pass the Scenario operation as `generationOperation`, not `operation`. `operation` is an alias of `action` on this tool.

```text
→ action_asset_generation(action="start", kind="image", generationOperation="upscale", sourcePath="assets/…", dryRun=true)
→ action_asset_generation(action="start", kind="image", generationOperation="upscale", sourcePath="assets/…", waitMs=30000)
```

- `query_asset_generation(operation="listKinds")` lists each operation and the kinds it supports.
- Use `sourceGenerationId` instead of `sourcePath` to derive from a saved generation of this project.

## Generate an image

Ask before spending credits. A dry-run does not start a job. Omit `modelId`. The server picks the same public model as the Image tab (featured, then a flux-like name, then the first image model). Do not switch to a base or built-in model when that default is missing.

```text
→ action_asset_generation(action="start", kind="image", prompt="…", dryRun=true)
→ action_asset_generation(action="start", kind="image", prompt="…", waitMs=30000)
→ query_asset_generation(operation="getStatus", generationId=…, waitMs=45000) until status is saved or failed
```

- Images are saved only. There is no scene apply. Use `savedPaths` as a UI image or a texture path.
- Pass `options.width` and `options.height` when the user asked for a size. The server maps those to `aspectRatio` when the model does not accept pixel size.
- Do not call `start` again to retry a failure. Another start spends credits.

## Generate a PBR texture

Ask before spending credits. Texture generations default to PBR maps.

```text
→ action_asset_generation(action="start", kind="texture", prompt="…", dryRun=true)
→ action_asset_generation(action="start", kind="texture", prompt="…", options={ "pbr": true }, waitMs=30000)
→ query_asset_generation(operation="getStatus", generationId=…, waitMs=45000) until status is saved or failed
→ action_asset_generation(action="apply", generationId=…, targetNodeIds=[…])
```

- `apply` creates a material from the albedo, normal, roughness, metallic, height, and AO maps and assigns it to the target nodes.
- Pass `referenceImages` when the user attached an image. The chat prompt lists absolute paths. Pass those paths unchanged. The server uploads the image bytes to Scenario.

## Generate a 3D model from an attached image

3D jobs take several minutes. Poll with `waitMs: 45000` and tell the user it is still running.

```text
→ action_asset_generation(action="start", kind="model3d", prompt="…", referenceImages=["C:/path/to/project/.editor/assistant-attachments/….png"], dryRun=true)
→ action_asset_generation(action="start", kind="model3d", prompt="…", referenceImages=[…], waitMs=45000)
→ query_asset_generation(operation="getStatus", generationId=…, waitMs=45000) until status is saved or failed
→ action_asset_generation(action="apply", generationId=…, placement="nearSelection")
```

- `placement` is `cameraLookAt` (default) or `nearSelection` when something is selected.
- Omit `modelId`. The server picks a public image-to-3D model (featured, then Hunyuan). Do not pass an image model such as FLUX.
- If the user attached an image, the prompt includes `Reference images saved on disk` and absolute paths. Pass those paths as `referenceImages`. The server uploads the image bytes to Scenario. Do not rewrite them as `@project/` paths.
