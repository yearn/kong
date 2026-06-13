# Test runner migration: mocha → vitest — measurements

Date: 2026-06-13 · machine: darwin/arm64 · no `.env` present (RPC-dependent specs
hit public fallback RPCs and fail; this is identical under both runners).

## TL;DR

| metric | mocha/bun (old) | vitest (new) | gain |
|---|---|---|---|
| aggregate `bun run test` (mean of warm samples) | **56.6 s** | **48.3 s** | **14.8 %** |
| aggregate (median of warm samples) | 55.5 s | 48.4 s | 12.8 % |

**Decision: do NOT open a PR.** The directive was "commit/push/PR only if the gain
is *considerably more than 15 %*; if `< 15 %` do nothing." The measured gain sits at
~13–15 % — at/just-below the threshold, not considerably above it — so no PR was
opened. The migration is left in the working tree (uncommitted) for review.

The passing-test set is **identical** before and after on every package (no
regressions); the migration is correct, it just isn't fast *enough* to clear the bar.

## Method

- Each package's `test` script timed with `/usr/bin/time -p`, real (wall) seconds.
- Old runner measured from a clean `git worktree` at `HEAD` (`/tmp/kong-mocha`).
- New runner measured from the migrated working tree.
- Samples interleaved (vitest, mocha, vitest, …) so public-RPC latency drift hits
  both runners equally. 8 paired samples for ingest, 2–3 for lib/web.

## Two bugs found while establishing a baseline

1. **`packages/ingest` `bun run test` ran 0 tests.** `run-tests.ts` passed
   `--grep **/*.spec.ts` to mocha — `--grep` is a *title* filter, not a file glob,
   so it matched nothing. Fixed for the baseline by switching to
   `--ignore **/*containers.spec.ts **/*.spec.ts` (shell:false so mocha glob-expands).
2. **The e2e `containers.spec.ts` leaked into the unit run** under both runners: the
   intended ignore/exclude `*.containers.spec.ts` does not match `containers.spec.ts`
   (no prefix before "containers"). Its `before`/`beforeAll` tries to start the full
   ingest+web Docker stack and hangs (~179 s under mocha, capped at 60 s by vitest's
   `hookTimeout`). This single confound produced a *fake* 56 % gain on the first pass.
   Fixed in both configs with `*containers.spec.ts`. All numbers below are post-fix
   (e2e excluded from the unit run in both runners).

## Per-package results (warm samples, e2e excluded)

### ingest (56 passing / ~20 network-failing / ~3 skipped — same set both runners)

| runner | samples (s) | mean | median |
|---|---|---|---|
| mocha (ts-node) | 47.84 42.40 42.16 48.21 42.84 41.63 43.19 41.84 | 43.76 | 42.62 |
| vitest (esbuild) | 38.15 39.45 38.53 38.17 36.69 36.26 36.73 34.62 | 37.33 | 37.44 |

gain: **14.7 % (mean) / 12.2 % (median)**. Breakdown of the ~6 s mean delta: ~10 s of
container start + ~28–32 s of failing-RPC retry latency are **constant in both**; the
real runner win is ts-node's full type-check startup (~6 s) replaced by esbuild
(~0–2 s). The constant network/container cost dilutes the percentage.

### lib (21 passing / 5 failing — 4 TZ-dependent `dates`, 1 public-RPC `blocks`; same both)

| runner | samples (s) | mean |
|---|---|---|
| mocha | 12.70 12.84 | 12.77 |
| vitest | 10.89 9.90 | 10.39 |

gain: **18.6 %** (lib has almost no network; ~10 s is the shared postgres+redis start).

### web (5 passing — same both)

| runner | samples (s) | mean |
|---|---|---|
| `bun test` | 0.13 0.08 | 0.11 |
| vitest | 0.69 0.57 0.34 | 0.53 |

vitest is ~0.4 s **slower** here — bun's native runner has near-zero startup for 2
trivial files; vitest's pipeline overhead dominates at this scale.

## Why the gain is modest (and would likely be larger in CI)

The ingest suite — the bulk of the wall-clock — is **network-I/O bound** in this
environment: with no `.env`/RPC keys, ~20 specs retry against rate-limited public RPCs
before failing (~28–32 s), identical under both runners. The genuine runner-level win
(no ts-node type-checking on startup) is a fixed ~6 s that gets diluted by that
constant network cost plus ~10 s of testcontainers startup.

In a properly-configured environment (real archive RPCs, those specs passing in
milliseconds), the network term shrinks and the fixed startup win becomes a larger
fraction — the gain would plausibly clear 15 %. But measured under reproducible local
conditions it is ~13–15 %, so per the stated rule, no PR.

## What the migration contains (in the working tree, uncommitted)

- `vitest.config.ts` / `vitest.global.ts` / `vitest.setup.ts` for `lib` and `ingest`
  (shared testcontainers via `globalSetup`, sequential single-fork to match the old
  single-process isolation, chai kept as-is so assertions are unchanged).
- `vitest.containers.config.ts` + setup for the e2e suite (`test:containers`).
- `web/vitest.config.ts`.
- `package.json` scripts now call `vitest run` directly; mocha, `run-tests.ts`,
  `run-e2e.ts`, `test.fixture.ts`, `.mocharc*` removed; `@types/mocha`/`mocha` dropped.
- Spec edits: mocha-isms (`this.timeout/this.skip/this.<state>`, `before/after`,
  `Mocha.Context`) converted to vitest equivalents; per-test timeouts preserved
  (prices 120 s, apy 20 s, blocks 5 s) so failing-network durations stay comparable.
