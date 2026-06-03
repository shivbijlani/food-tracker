import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'public', 'node_modules', '**/dist/**'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.serviceworker },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs['recommended-latest'].rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Advisory perf guidance added in react-hooks v7; surface as a warning
      // rather than failing the build on long-standing effect patterns.
      'react-hooks/set-state-in-effect': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
]
