# Disabling triggers/cron - fanout

Disabling the cron jobs can be handy sometimes, for eg when a breaking change is made on a webhook and there's the need to deploy another service before rolling kong changes.

## Steps
- go to render -> shell
- on the attached tty
  - `cd packages/terminal`
  - `bun run (or yarn doesnst matter) production`
  - disable fanout `crons` -> toggle `Abi Fanout`
