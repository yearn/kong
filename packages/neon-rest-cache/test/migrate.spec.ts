import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationScript = resolve(fileURLToPath(new URL('../scripts/migrate.mjs', import.meta.url)))

describe('database migration entrypoint', () => {
  it('loads as native ESM before reporting a missing DATABASE_URL', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'neon-rest-cache-migrate-'))
    const env = { PATH: process.env.PATH ?? '' }

    try {
      const result = spawnSync(process.execPath, ['--env-file-if-exists=.env', migrationScript], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 5_000,
      })

      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Set DATABASE_URL explicitly')
      expect(result.stderr).not.toContain("Named export 'Pool' not found")
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
