# Allocation history: high-level implementation spec

> Draft implementation plan for the finished behavior described in the [README](README.md). This document defines the changes to Kong, their responsibilities, and the order in which to deliver them. Detailed schemas and operating limits are finalized within the steps below.

## 1. Outcome and scope

Add a background refresh job that turns stored on-chain events, historical RPC state, and optional optimizer policies into allocation-history data. Publish that data through the chart and action-detail REST endpoints described in the README.

Powerglove is the reference consumer. The [yvUSDC-1 sample pack](samples/yvusdc-1/README.md) supplies real prototype responses for early integration and contract review. Its provisional coverage and documented differences from the intended response remain explicit.

This work includes:

- Reading required event evidence through Kong's data layer.
- Resolving historical strategies and allocator assignments.
- Fetching and reusing historical balances, configuration, and execution evidence.
- Building allocation actions, optional policy relationships, and reconciled intervals.
- Storing and publishing complete runs, with stable pagination and detail lookup.
- Backfill, recurring refresh, validation, monitoring, and staged activation.

Event acquisition, upstream discovery, and upstream event backfills remain with the ingestion work in [Kong #402](https://github.com/yearn/kong/issues/402). This feature specifies the evidence it needs without introducing a separate Envio connection or new GraphQL API. The current-allocator corrections in [Kong PR #472](https://github.com/yearn/kong/pull/472) remain an independently deliverable prerequisite where their resolver can be shared.

## 2. Where the changes fit in Kong

| Area | Change | Existing integration point |
| --- | --- | --- |
| Event and vault reads | Add queries for eligible vaults and the ordered evidence needed for their history. | `thing` and `evmlog`; see the [reports database helpers](../../packages/web/app/api/rest/reports/db.ts). |
| Refresh processing | Add one allocation-history pipeline with backfill and incremental modes. | Follow the separation between [refresh logic](../../packages/web/app/api/rest/reports/refresh.ts) and its [CLI entrypoint](../../packages/web/app/api/rest/reports/refresh.cli.ts). |
| Persistent storage | Add migrations for runs, prepared history, and reusable historical evidence. | [Kong database migrations](../../packages/db/migrations). |
| Public reads | Add chart and action-detail routes under `packages/web/app/api/rest/views/allocation-history/`. | Kong REST parameter validation, CORS, and response conventions. |
| Job execution | Connect the shared refresh function to a runner suitable for its workload. | [Authenticated job handler](../../packages/web/app/api/cron/handler.ts), [cron database pool](../../packages/web/app/api/db/cron.ts), and CLI conventions. |
| Optional response caching | Cache responses by immutable run and request parameters. | [REST cache helpers](../../packages/web/app/api/rest/cache.ts). |

Keep the processing, persistence, and HTTP handlers separate. The route handlers select and return prepared data. They do not perform event replay or upstream enrichment.

The allocation-service prototype is a reference for processing rules and fixtures. Port those responsibilities into Kong's conventions while removing prototype-specific ingestion and checkpoint dependencies.

## 3. Agree the input and output contracts first

### Required event evidence

Define a Kong-side input contract covering the following families. ABI-specific signatures and decoded fields are recorded during implementation; overloaded names must retain their contract-family meaning.

| Evidence | Required events or information |
| --- | --- |
| Vault accounting and lifecycle | `Deposit`, `Withdraw`, `DebtUpdated`, `StrategyReported`, `StrategyChanged`, `UpdatedMaxDebtForStrategy`, and `DebtPurchased`. |
| Vault configuration and permissions | `UpdateDefaultQueue`, `UpdateUseDefaultQueue`, `RoleSet`, `RoleStatusChanged`, `UpdateRoleManager`, and `UpdateAccountant`. |
| Role Manager membership and assignments | `AddedNewVault`, `UpdateDebtAllocator`, and `RemovedVault`, interpreted with the authoritative Role Manager at that position. |
| Allocator configuration and control | Supported singular/plural strategy-ratio events, including vault-scoped shared-allocator variants; `UpdateKeeper` and `GovernanceTransferred`. |
| Deployment provenance | Family-specific `NewDebtAllocator` evidence when available. Deployment provenance is distinct from an active assignment. |

Each event needs a stable identity, chain, emitting contract, decoded arguments, block identity and timestamp, transaction hash, transaction index, and log index. Preserve its vault association or allocator scope. Transaction call-path metadata can be supplemented during enrichment.

The reader must provide complete pagination, coverage bounds, known gaps, and a way to detect corrections to previously processed evidence. A recent event or the absence of rows does not establish complete coverage. Earlier assignment and configuration evidence may be needed to initialize the start of a published range.

Missing inputs become a concrete handoff to the ingestion team. Kong development can proceed against pinned fixtures while that work is completed. Production activation waits for the required evidence.

### Public response contract

Use the README's chart and detail responses as the target. Resolve the sample-to-target differences up front: top-level `runId`, asset metadata in the chart response, coverage fields, and removal of Envio-specific accounting-checkpoint requirements.

Define shared response types and validate them with the consumer before implementing expensive history processing. Keep the captured sample files unchanged; adapted or synthetic contract fixtures must be separately identified. The current sample checks internal consistency, not completeness or independent correctness of execution classifications.

## 4. Build the refresh pipeline

Both backfill and incremental refresh call the same pipeline. The input is a vault, a processing mode, and the source revisions used for the run. The output is a complete candidate run ready for validation and publication.

```text
Vault inventory + stored events + previous run
                       |
                       v
        Select covered, finalized block range
                       |
                       v
       Resolve strategies and allocator history
                       |
                       v
          Fetch or reuse historical evidence
                       |
                       v
          Build and classify allocation actions <--- Optional policy feed
                       |
                       v
        Build chart intervals and detail responses
                       |
                       v
           Validate coverage and accounting
                       |
               +-------+-------+
               |               |
             Pass             Fail
               |               |
               v               v
      Publish complete run   Retain prior run;
               |            record failed attempt
               v
       Chart and detail REST reads
```

### A. Select the range and establish context

Select supported Yearn V3 multi-strategy vaults from Kong's inventory, initially on Ethereum, Base, and Katana. Track enrollment and publication readiness per vault.

Bound processing by both finalized chain state and verified coverage of required event families. Pin source revisions and the prior published run. Order events by block, transaction, log position, and stable identity.

Recover the strategy universe and allocator assignment at each relevant position. Retain revoked strategies that still have debt, shared-allocator relationships, and assigned addresses with unsupported interfaces. A replacement must not inherit its predecessor's targets.

### B. Fetch and reuse historical evidence

Read vault totals, strategy debt, and supported allocator configuration at the required block boundaries. Use transaction traces, role history, and historical allocator recommendation checks where needed for execution attribution.

Block-level reads establish block-level states. Preserve contributing transactions separately and disclose same-block ambiguity rather than claiming transaction-exact snapshots.

Reuse successful finalized reads by canonical block identity and relevant inputs. Failed reads remain retryable. Corrections to event evidence invalidate affected derived states; a conflicting finalized block identity stops publication until resolved.

### C. Build actions and attach policies

Build atomic changes, then group related transactions using execution evidence and state continuity. Time proximity alone is insufficient. Insufficient grouping evidence leaves changes separate at the supported granularity.

Keep the economic action kind, execution mechanism, automation, and target match separate. Missing attribution stays unknown. Preserve configurations and other operations contributing to a grouped action.

Attach optimizer policies where matching evidence supports the relationship. An observed target-setting event and a historical configuration inference have different evidence strength. A policy can govern later actions, and its expected APR remains a proposal estimate. Policy-feed failure does not prevent publication of otherwise valid executed history.

### D. Build intervals and validate

Select strategy reallocations as historical chart entries. Add the latest safe snapshot separately. Build intervals from the complete intervening activity, including events hidden from the compact chart.

Validate exact integer accounting for states and each strategy/idle node in an interval. Retain explicit unattributed balancing flows when the accounting balances but the cause is unresolved. Missing required balances or event coverage cannot be repaired by inserting a residual.

Produce compact chart records and the corresponding full action details together. Both must describe the same candidate run.

## 5. Store and publish complete runs

Use Kong Postgres as the durable store for run metadata, prepared chart records, action details, and the evidence needed for reconstruction and reuse. A fully queryable normalized public model is not required to serve these endpoints.

Each run records its vault, covered range, safe block, source and processing revisions, generation time, quality information, and status. Published records are immutable. Deterministic action identities and explicit ordering support comparison between runs.

Build a candidate run separately from the published run. After validation, mark it successful and switch the vault's active-run reference in one database transaction. Failed work leaves that reference untouched. Prevent concurrent writers per vault, including an interrupted job attempting to publish after a replacement job has started.

If Redis is used, key prepared responses by run and query parameters. Postgres remains authoritative for publication. A cache miss reads the prepared database records; it does not trigger upstream work. An older cached response must still reference its own complete run.

Retain old runs for the maximum supported lifetime of their cursors and detail references, including the HTTP caching allowance. Define expiry behavior before enabling cleanup. An expired reference returns an explicit error and never silently resolves against a newer run.

## 6. Add REST reads and recurring operation

Implement the two routes from the README:

```http
GET /api/rest/views/allocation-history/:chainId/:address?projection=chart
GET /api/rest/views/allocation-history/:chainId/:address/entries/:entryId?runId=:runId
```

Chart pagination selects an immutable run on the first request and preserves it on subsequent requests. Filter visible entries before applying the page limit. Supply strategy names and any required boundary states on each page; include the current snapshot only on the first page. Detail links select the same run.

Apply Kong's REST conventions for validation, CORS, caching, and error responses. Missing published history is distinct from an empty successful history. Production responses must expose the covered range and snapshot time so a retained older run is not mistaken for current data.

Start with an operator-invoked CLI for bounded backfills and refreshes. Connect recurring refresh to Kong's authenticated job or worker infrastructure once measured runtime fits the chosen runner. Existing HTTP jobs have execution limits; long backfills need a suitable process rather than an unbounded HTTP request.

Incremental refresh reuses unchanged history and revisits the affected suffix for late events, corrected evidence, changed policy relationships, and groups spanning the refresh boundary. Do not treat all historical data as immutable solely because its blocks are finalized. A complete replay is an acceptable development baseline; bounded recurring work is required before broad scheduled operation.

Record the last successful publication, latest attempt, safe block, processing duration, reused work, and failures per vault. A failed vault must not prevent independent vaults from being processed, but the job summary must report the failure.

## 7. Delivery sequence

Each step should produce a reviewable change with its own validation. The steps can be separate PRs; they do not require one large migration PR.

| Step | Deliverable | Ready to proceed when |
| --- | --- | --- |
| 1. Contracts and fixture integration | Input contract, response types, sample-to-target mapping, and consumer fixture checks. | The chart and detail requirements are agreed; missing upstream evidence has an owner. |
| 2. Ordered evidence and state reconstruction | Kong event reader, shared assignment resolver/adapters, RPC enrichment, and reuse of finalized evidence. | Historical states reconcile; replacements, shared allocators, missing values, and successful zero values are handled correctly. |
| 3. Actions and intervals | Grouping, execution classification, policy relationships, flow accounting, and both prepared response shapes. | Representative automatic/manual/unknown cases and multi-transaction boundaries pass; every interval balances with honest attribution. |
| 4. Persistence and REST | Migrations, isolated candidate runs, atomic publication, chart pagination, and detail lookup. | Failed publication preserves the previous run; pagination and details remain consistent across a refresh; reads make no upstream calls. |
| 5. Recurring operation | Incremental refresh, correction handling, concurrency recovery, monitoring, and retention. | Full and incremental runs agree at fixed inputs; runtime and storage measurements support the selected schedule and cursor lifetime. |
| 6. Production activation | A verified pilot vault, consumer integration, and subsequent per-vault enrollment. | Required coverage is verified and the pilot succeeds under recurring operation before expanding across chains. |

Use yvUSDC-1 as the first integration case. Exercise both known rebalancing actions and a refresh while the consumer is paging. Keep provisional fixtures available for UI development without treating their successful rendering as permission to publish incomplete production history.

Rollback stops or disables the affected refresh/publication path and restores a retained valid run when appropriate. Run selection and response caches must agree. If no valid run exists, report history unavailable.

## 8. Decisions to close during implementation

| Decision | Resolve by |
| --- | --- |
| Exact input fields, ABI variants, coverage evidence, and correction notification/revision mechanism | Contract step, with the ingestion team. |
| Final response types, coverage fields, cursor expiry errors, and asset metadata | Contract step, with the reference consumer. |
| Missing supported allocator adapters and historical role/call-path evidence | State reconstruction and classification steps. |
| Event correction handling and how much affected history must be reprocessed | Incremental step, tested against full rebuilds. |
| Runner, refresh frequency, concurrency limits, cursor lifetime, and retained-run storage budget | Operational step, using measured pilot workload. |

Completion means that eligible vaults refresh reliably, REST serves one internally consistent published run, and Powerglove can render and inspect the history using only those responses. Verify full/incremental equivalence by comparing state, action, policy, interval, and quality content at identical safe blocks and source/processing revisions; run IDs, generation times, and run-specific links are expected to differ.
