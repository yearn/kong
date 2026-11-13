import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
}

await build({ ...common, entryPoints: ['src/index.ts'], outdir: 'dist/function' })
await build({ ...common, entryPoints: ['src/local.ts'], outfile: 'dist/local/local.mjs' })
