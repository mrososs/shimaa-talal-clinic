import vue from 'eslint-plugin-vue';
import baseConfig from '../../eslint.config.mjs';

export default [
  {
    // Native projects are generated build artifacts. During the PWA migration
    // they remain locally for rollback, but they are not application source.
    ignores: ['android/**', 'ios/**', '.idea/**'],
  },
  ...baseConfig,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: await import('@typescript-eslint/parser'),
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',

      // Ionic's components are web components, and 'slot' is how they are
      // told where content goes - <ion-refresher slot="fixed"> is Ionic's
      // own documented API, not the deprecated Vue 2 slot syntax this rule
      // is about.
      'vue/no-deprecated-slot-attribute': 'off',
    },
  },
];
