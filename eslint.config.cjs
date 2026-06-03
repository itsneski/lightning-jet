const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'old-jet-caporal.js',
      '*.backup',
    ],
  },

  js.configs.recommended,

  {
    files: ['jet', 'cli/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-global-assign': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-empty': [
        'warn',
        {
          allowEmptyCatch: true,
        },
      ],
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      eqeqeq: ['warn', 'smart'],
    },
  },
];