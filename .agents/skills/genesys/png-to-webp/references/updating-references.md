# Updating Asset References

After converting and deleting PNGs, any code or data file that references the old `.png` paths must be updated.

## Find all .png references in source code

```bash
rg "\.png" src/
```

## Batch replace in source files (one folder at a time)

Replace `.png` with `.webp` for references under a specific asset folder. Be precise with the folder prefix to avoid touching unrelated files:

```bash
# Update UI references
rg -l "assets/UI/.*\.png" src/ | ForEach-Object { (Get-Content $_) -replace 'assets/UI/([^"'']*?)\.png', 'assets/UI/$1.webp' | Set-Content $_ }

# Bash equivalent
rg -l "assets/UI/.*\.png" src/ | xargs sed -i 's|assets/UI/\([^"]*\)\.png|assets/UI/\1.webp|g'
```

## Update JSON asset files

Scene files, material JSON, and prefabs also contain asset paths:

```bash
# Find JSON files referencing PNGs (exclude the actual PNG/WebP files themselves)
rg -l "\.png" assets/ --glob "*.json" --glob "*.genesys-scene" --glob "*.prefab.json"
```

Then replace selectively per folder. Always scope the replacement to the subfolder that was converted:

```bash
# In PowerShell:
Get-ChildItem assets/ -Recurse -Include "*.material.json","*.prefab.json","*.genesys-scene" |
  ForEach-Object {
    (Get-Content $_.FullName) -replace '\.png"', '.webp"' | Set-Content $_.FullName
  }
```

## Add to package.json scripts (optional)

```json
{
  "scripts": {
    "convert-ui": "node tools/convert-png-to-webp.mjs assets/UI",
    "clean-ui-png": "node tools/remove-png-originals.mjs assets/UI"
  }
}
```

Then run:

```bash
pnpm convert-ui
# verify output looks correct in-game, then:
pnpm clean-ui-png
```

## Dry run before deleting

Always preview what the delete script would remove before running it for real:

```bash
node tools/remove-png-originals.mjs assets/UI --dry-run
```
