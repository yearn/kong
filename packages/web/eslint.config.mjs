import rootConfig from '../../eslint.config.mjs'

export default [{
  ignores: ['next-env.d.ts'],
}, ...rootConfig, {
  files: ['*.config.js'],
  languageOptions: {
    sourceType: 'commonjs',
    globals: {
      module: 'writable',
      require: 'readonly',
      process: 'readonly',
      __dirname: 'readonly',
    },
  },
}]
