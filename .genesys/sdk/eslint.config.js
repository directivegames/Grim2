import { createGenesysConfig } from '@gnsx/genesys.js/eslint-config';

export default createGenesysConfig({
  preset: 'game',
  tsConfigPaths: ['./tsconfig.json'],
  ignores: ['dist/**', '.engine/**', 'node_modules/**', '**/*.d.ts'],
  files: ['**/*.ts', '**/*.tsx'],
  includeStyleRules: false
});
