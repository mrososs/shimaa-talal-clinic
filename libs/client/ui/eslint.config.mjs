import vue from 'eslint-plugin-vue';
import baseConfig from '../../../eslint.config.mjs';

export default [
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
    files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',

      // This library is shared by an Ionic app and a plain Vue one. An Ionic
      // import here would compile in the mobile app and break the dashboard,
      // where Ionic is banned — and it would break at the app's build, far
      // from the line that caused it. Refuse it at the source instead.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ionic/*', '@capacitor/*'],
              message:
                'Shared client UI must render in both apps; the dashboard has no Ionic.',
            },
          ],
        },
      ],
    },
  },
];
