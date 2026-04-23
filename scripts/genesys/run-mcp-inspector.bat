pushd %~dp0
cd ..
set DANGEROUSLY_OMIT_AUTH=1
pnpm dlx @modelcontextprotocol/inspector pnpm dlx tsx ./scripts/genesys/genesys-mcp.ts
popd