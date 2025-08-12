# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `make dev` - Start full development environment with tmux, redis, postgres, and all services
- `make test` - Run tests for lib and ingest packages
- `make down` - Shutdown development environment and clean up containers

### Package-specific Commands
- `bun --filter <workspace> test` - Test individual workspaces (lib, ingest, web)
- `bun --filter ingest test` - Test ingest package specifically
- `bun --filter lib lint` - Lint lib package
- `bun --filter <workspace> lint --fix` - Fix linting issues in specific workspace

### Database Operations
- `bun --filter db migrate create <name> --sql-file` - Create new database migration
- `bun --filter db migrate up` - Run pending migrations
- `bun --filter db migrate down [-c count]` - Rollback migrations

### tmux Navigation (in dev mode)
- `ctrl+b` then arrow keys - Navigate between panes
- `ctrl+b` then `z` - Zoom/unzoom current pane
- `ctrl+b` then `[` - Enter scroll mode, use arrow keys, `q` to quit
- `ctrl+b` then `:kill-session` - Exit development environment

## Architecture Overview

Kong is a real-time/historical EVM indexer with these core components:

### Monorepo Structure
- `packages/ingest/` - Core indexer service (Node.js with BullMQ)
- `packages/web/` - Next.js web app with GraphQL API
- `packages/lib/` - Shared utilities and types
- `packages/db/` - Database migrations (db-migrate)
- `packages/terminal/` - CLI interface for runtime interaction
- `config/` - YAML configuration files for indexing

### Key Concepts

**Convention-based ABI System**: Relationship between `config/abis.yaml` and `packages/ingest/abis/` directory structure. ABIs are organized by protocol/version (e.g., `yearn/3/vault/`).

**Hooks System**: Custom logic for data enrichment in three types:
- `snapshot/hook.ts` - Process contract state snapshots
- `event/hook.ts` - Process event logs
- `timeseries/hook.ts` - Generate time-series data

**Things**: Domain entities (vaults, strategies) created by hooks and used as sources for further indexing.

**Message Queue Architecture**: Uses BullMQ on Redis for coordinating indexing jobs (fanout → extract → load).

### Database Schema
- `evmlog` - Raw EVM logs with hook enrichment
- `snapshot` - Latest contract state with hook data
- `thing` - Domain object definitions
- `output` - Time-series hook results
- `evmlog_strides` - Block coverage tracking

### Development Workflow
1. Terminal UI: Select `ingest` → `fanout abis` to start indexing
2. Multiple fanout runs may be needed for full initialization
3. Use `fanout replays` to replay hooks after code changes
4. GraphQL explorer available at http://localhost:3001/api/gql

## Technology Stack
- **Runtime**: Bun (primary), Node.js
- **Testing**: Mocha + Chai
- **Database**: PostgreSQL with TimescaleDB
- **Message Queue**: Redis + BullMQ
- **Web Framework**: Next.js with Apollo GraphQL
- **Blockchain**: viem (version 2.5.0 - keep consistent across packages)

## Configuration Requirements
Copy `.env.example` to `.env` and configure:
- RPC endpoints for supported chains (1, 10, 137, 250, 8453, 42161)
- Redis connection details
- External API keys (YDAEMON, YPRICE)