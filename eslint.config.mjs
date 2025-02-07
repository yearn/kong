import typescriptEslint from '@typescript-eslint/eslint-plugin'
import react from 'eslint-plugin-react'
import tsParser from '@typescript-eslint/parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
})

export default [{
  ignores: [
    '**/node_modules',
    '**/.next',
    '**/out',
    '**/dist',
    '**/build',
    '**/coverage',
  ],
}, ...compat.extends(
  'eslint:recommended',
  'plugin:@typescript-eslint/recommended',
  'plugin:react/recommended'
), {
  plugins: {
    '@typescript-eslint': typescriptEslint,
    react
  },

  languageOptions: {
    parser: tsParser,
  },

  settings: {
    react: {
      version: 'detect',
    },
  },

  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-expressions': 'off',
    '@typescript-eslint/no-unused-disable': 'off',
    '@typescript-eslint/no-require-imports': 'off',

    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react/jsx-indent': 'off',
    'react/jsx-indent-props': ['error', 2],
    'react/jsx-closing-bracket-location': ['error', 'after-props'],

    'react/jsx-max-props-per-line': ['error', {
      maximum: 1,
      when: 'multiline',
    }],

    'react/jsx-tag-spacing': ['error', {
      closingSlash: 'never',
      beforeSelfClosing: 'always',
      afterOpening: 'never',
      beforeClosing: 'never',
    }],

    indent: ['error', 2],
    semi: ['error', 'never'],
    quotes: ['error', 'single'],
  },
}]
