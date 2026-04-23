import tsParser from '@typescript-eslint/parser';
import noDefaultClassFields from '../../node_modules/@gnsx/genesys.js/eslint-rules/no-default-class-fields.js';
import defaultGetterReturnType from '../../node_modules/@gnsx/genesys.js/eslint-rules/default-getter-return-type.js';
import noOverrideMethods from '../../node_modules/@gnsx/genesys.js/eslint-rules/no-override-methods.js';
import noAsyncOverrideMismatch from '../../node_modules/@gnsx/genesys.js/eslint-rules/no-async-override-mismatch.js';
import noDeprecatedConstructor from '../../node_modules/@gnsx/genesys.js/eslint-rules/no-deprecated-constructor.js';
import sceneComponentMaterialType from '../../node_modules/@gnsx/genesys.js/eslint-rules/scene-component-material-type.js';
import tweenTimeArgument from '../../node_modules/@gnsx/genesys.js/eslint-rules/tween-time-argument.js';
import requireCreateMethod from '../../node_modules/@gnsx/genesys.js/eslint-rules/require-create-method.js';
import classRegistrationDecoratorOnly from '../../node_modules/@gnsx/genesys.js/eslint-rules/class-registration-decorator-only.js';


export default [
  {
    ignores: ['dist/**', '.engine/**', 'node_modules/**', '**/*.d.ts']
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json']
      }
    },
    plugins: {
      'custom': {
        rules: {
          'no-override-methods': noOverrideMethods,
          'no-default-class-fields': noDefaultClassFields,
          'default-getter-return-type': defaultGetterReturnType,
          'no-async-override-mismatch': noAsyncOverrideMismatch,
          'no-deprecated-constructor': noDeprecatedConstructor,
          'scene-component-material-type': sceneComponentMaterialType,
          'tween-time-argument': tweenTimeArgument,
          'require-create-method': requireCreateMethod,
          'class-registration-decorator-only': classRegistrationDecoratorOnly
        }
      }
    },
    rules: {
      'custom/no-override-methods': 'error',
      'custom/no-default-class-fields': 'error',
      'custom/default-getter-return-type': 'error',
      'custom/no-async-override-mismatch': 'error',
      'custom/no-deprecated-constructor': 'error',
      'custom/scene-component-material-type': 'error',
      'custom/tween-time-argument': 'error',
      'custom/require-create-method': 'error',
      'custom/class-registration-decorator-only': 'error'
    }
  },
  {
    files: ['games/**/*.ts', 'games/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['../src/**', '!../src/index.js']
      }]
    }
  }
];
