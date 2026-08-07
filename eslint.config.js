// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const twoferPlugin = {
  rules: {
    'require-text-color': require('./eslint-rules/require-text-color'),
  },
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    plugins: { twofer: twoferPlugin },
    rules: {
      // Uncolored <Text> defaults to black and disappears in dark mode.
      'twofer/require-text-color': 'error',
    },
  },
  {
    // DEV-only poster gallery — removable tooling, not shipped app logic.
    files: ['app/poster-gallery-dev.tsx'],
    rules: {
      'twofer/require-text-color': 'off',
    },
  },
]);
