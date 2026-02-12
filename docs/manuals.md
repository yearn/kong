# One time vault initialization

A manual process is required for indexing a new vault which was added manually through `config/manuals.yaml`.

## Process

- Merge the change onto main
- Check render dashboard for deployment progress
- when deployed go to `ingest-v-2` -> `shell`
- on the attached tty
   - `cd packages/terminal`
   - `bun run (or yarn doesnst matter) production`
   - trigger `ingest` -> `extract manuals`
