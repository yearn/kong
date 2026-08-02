import babelParser from '@babel/eslint-parser'
import react from 'eslint-plugin-react'
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
  'plugin:react/recommended'
), {
  plugins: {
    react
  },

  languageOptions: {
    parser: babelParser,
    parserOptions: {
      requireConfigFile: false,
      babelOptions: {
        presets: [
          '@babel/preset-typescript'
        ]
      }
    }
  },

  settings: {
    react: {
      version: 'detect',
    },
  },

  rules: {
    'no-unused-vars': 'warn',

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
}, {
  files: ['**/*.jsx', '**/*.tsx'],

  languageOptions: {
    parser: babelParser,
    parserOptions: {
      requireConfigFile: false,
      babelOptions: {
        presets: [
          '@babel/preset-react',
          '@babel/preset-typescript'
        ]
      }
    }
  },
}, {
  files: ['**/*.ts', '**/*.tsx'],
  rules: {
    'no-undef': 'off',
    'no-redeclare': 'off',
    'no-unused-vars': ['warn', {
      args: 'none',
      varsIgnorePattern: '^[A-Z][a-zA-Z0-9]*$',
    }],
  },
}]
