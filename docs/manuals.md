# Vault initialization via manuals

Vaults added through `config/manuals.yaml` are now extracted **automatically** as part of the ABI fanout cycle (every 15 minutes). No manual intervention is required after merging.

## Automatic flow

1. Merge the change onto main
2. Wait for deployment (check render dashboard)
3. On the next ABI fanout cycle, `extract manuals` runs automatically before the ABI source/thing loop

## Manual fallback

If you need to trigger extraction immediately without waiting for the next cycle:

- Go to `ingest-v-2` -> `shell`
- On the attached tty:
   - `cd packages/terminal`
   - `bun run production`
   - Trigger `ingest` -> `extract manuals`
