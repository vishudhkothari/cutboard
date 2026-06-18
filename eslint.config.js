import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

/* Flat config (ESLint 9). Run with `npm run lint`.
   Catches the class of mistakes that slipped past before — undefined
   identifiers, unused vars, bad hook deps — without a heavy style ruleset. */
export default [
  { ignores: ['dist', 'public/sw.js', '*.dc.html'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.2' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',   // Vite's automatic JSX runtime
      'react/prop-types': 'off',           // app doesn't use prop-types
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]
