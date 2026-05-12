#!/usr/bin/env node
import { main } from './add-uv2-to-glbs';

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
