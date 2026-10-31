# Kong outbound bandwidth audit

Audit date: 2026-10-31. Repository and deployed application revision: `00d11981`.

The priority is reducing bytes sent by ingest, not rewriting its runtime. The supplied bill implies about $119.95 of workspace bandwidth overage versus $24.85 of ingest compute. Destination attribution is still missing; none of the code-level estimates below explains the whole 821.09 GB ingest total on its own.

## Recommended order after adversarial review

| Priority | Work | Savings evidence and boundary |
| --- | --- | --- |
| 1 | Add bounded outgoing-byte attribution; inspect actual BullMQ schedules and Sentry ingestion volume. Keep telemetry labels bounded and verify OTLP gzip. | Necessary to identify the remaining traffic. No destination percentage is established. |
| 2 | Compute TVL once for the two existing output formats when their requested observation matches. | Confirmed duplicated computation, including uncached contract reads; fleet-wide byte savings are unmeasured. Preserve both output labels and all rows. |
| 3 | Reduce repeated output SQL using a focused prepared-statement change or bounded bulk writes. | About 8.31 GB of normalized SQL text in the 4.647-day database window; a conditional ~$8/month opportunity at the observed rate. Compare alternatives, do not add their overlapping savings. |
| 4 | Evaluate provider-specific HTTP batching after measuring small-request volume and retries. | Current batch size zero prevents useful coalescing. Savings depend on headers/framing relative to body bytes. |
| 5 | Cache successful low-change metadata with a finite TTL and invalidation policy. | 7.13 million decimals lookups in the database window; complete-request avoidance is useful, but cache correctness matters. |
| 6 | Generate missing-day bounds at the server and reduce monitor cadence if operationally acceptable. | Small: approximately $0.81/month and $0.24/month scenarios, respectively, before SQL/protocol differences. |
| 7 | Compare Private Link or worker/queue hosting together. | Depends on measured destinations and all providers' fees; not justified by the current attribution evidence. |

The first implementation should establish the outgoing-byte baseline and keep its own telemetry cheap. A runtime rewrite is not justified by this audit. A 30% reduction in the supplied ~$120 overage is only ~$36/month: prefer contained changes that also reduce RPC charges or database work.

## Evidence and scope

- One Render Standard worker in Ohio; Redis uses an internal same-region hostname. Postgres uses a public Neon endpoint in AWS Ohio. RPC routes use Chainstack/Tenderly, and application telemetry goes to `infra-monitoring.yearn.dev`.
- Recent complete hourly ingest egress points are approximately 0.83–0.97 GB. Daily usage decreased from about 43.2 GB on October 24 to 24.3 GB on October 30; workload and deployments changed, so this is not an attributed optimization result.
- PostgreSQL counters cover October 27 04:02:24 through October 31 19:34:09 UTC, approximately 4.647 days. Counters have no recorded statement eviction in this window. They include every client of this database, not only Render. Historical values and source-code mapping establish optimization candidates, not measured network attribution.
- The audit used read-only Render APIs, PostgreSQL diagnostics, source inspection, and local payload-size calculations. No application changes, production configuration changes, resets of database statistics, tests, or lint were run.

## Duplicate TVL computation

Both `packages/ingest/abis/yearn/3/vault/timeseries/tvl/hook.ts` and `tvl-c/hook.ts` invoke the same `_process` in `packages/ingest/abis/yearn/lib/tvl.ts`; only the output format differs. The same pair exists for v2 vaults and ERC-4626 vaults. Each independently resolves the observation block, loads the vault, and calls `_compute`, including `readAuthoritativeAssets`. That contract-reading path has no application cache in `tranches/assets.ts`. V2 delegated-asset calculations can add more repeated reads.

Share the calculation when the chain, vault, observation block, and relevant inputs match, then produce both existing output formats. The legacy `tvl` row and five `tvl-c` component rows are both needed: this does not eliminate their six required database rows. Existing price and block caches already reuse some upstream work, so two function invocations do not imply twice as many requests everywhere. `hasComputedTvl` only runs on the unavailable-price path, not every calculation.

Preserve independent missing-day coverage, replay behavior, label-specific guards against overwriting real values with unavailable prices, and current-day freshness. Do not remove the legacy label or retain a shared live result across changing observations without an explicit freshness policy. There is no measured fleet-wide savings percentage or established “one in five jobs” reduction.

## Repeated database writes and SQL text

In the statistics window, the two common output upsert shapes ran 13,986,503 and 1,318,868 times. `upsertBatch` sends one SQL statement per row. Parameterized queries are unnamed, so node-postgres sends the SQL text on each call.

Multiplying their normalized SQL lengths by calls gives an 8.31 GB SQL-text proxy, excluding parameters, protocol overhead, encryption, and retransmissions. Scaling that window to 30 days gives about 53.7 GB, or $8.05 at $0.15/GB, IF the observed writes originate from Render and their frequency persists. This is an estimate of an avoidable component, not a measured saving or complete write-traffic volume.

The corresponding proxy for all 59 statements with over 100 calls is 19.48 GB, approximately 125.8 GB/month under the same assumptions. Many of those SELECTs are shared with other clients. Do not book this whole number as Render savings.

The first narrowly scoped implementation candidate is stable named prepared statements for the recurring output write shapes. Names must encode the exact statement shape, including omitted columns. Preparation repeats after reconnect; the pool has a ten-second idle timeout. Prepared SELECTs require checking generic-plan effects before broad rollout.

True bulk writes are a second option. Preserve row order when duplicate conflict keys occur; a single INSERT cannot affect the same conflict row twice. Preserve the distinction between omitted `value` and explicit NULL, existing transaction boundaries, and partial patch behavior. Avoid counting bulk-write and prepared-statement SQL savings twice. COPY would require additional staging/upsert logic.

## RPC requests

The deployed configuration has no RPC_BATCH_SIZE override. The shared client supplies a batch size of zero; installed viem 2.5.0 splits when queued count exceeds that value. As a result, it effectively sends individual JSON-RPC members in separate envelopes.

Provider-specific bounded HTTP batches with an explicit short wait window are worth measuring for header/framing savings. The current wait is zero, limiting coalescing to requests scheduled before the timer runs. An HTTP-envelope failure can reject multiple members, which the transport then retries individually. They retain logical calls and are not equivalent to on-chain Multicall3. They do not by themselves reduce Chainstack request units or calldata bytes. Measure provider limits, retry amplification, request latency, and block freshness before changing a production default.

A serialization calculation using the real ABIs and a synthetic address produced 11,021 bytes for a 28-getter v3 vault snapshot request, 11,405 for v2 vault, and 11,789 for v2 strategy. These are individual example request bodies, not traffic-weighted averages. They show why RPC body bytes deserve direct measurement.

Do not enable request gzip without establishing each provider's support. Synthetic gzip ratios are not production savings estimates. Accept-Encoding affects incoming responses and is not a fix for outgoing request bodies.

## Application telemetry

MQ_INVENTORY is enabled. Job metrics include contract addresses and exact from/to block values, creating many distinct label combinations. The current HTTP JSON exporter sends delta metrics every ten seconds. The installed SDK defaults to 2,000 series per instrument per collection, including an overflow series; the label combinations are not an unbounded exported-series count. The installed exporter defaults to no compression. Actual active series, overflow, and encoded/compressed bytes still need measurement. RPC_METRICS was absent from the inspected service overrides and linked secret file, so the source default leaves the two RPC instruments disabled.

Candidates are bounded queue/job/chain labels, temporary sampled diagnostics for address-level investigations, and OTLP gzip after verifying collector acceptance. A longer export interval can reduce envelope overhead, but the current ten-second interval is hardcoded and would require a code change. Do not rely on overflow to silently drop detailed series as the optimization. Retain the observability needed to assess correctness and retries. The OTLP deployment happened on October 31 and cannot explain the entire monthly bill. Platform-managed Render log/metric stream exemptions do not automatically apply to application HTTP exports.

Sentry is another unresolved destination. viem errors can embed the full RPC request body, making failed multicalls much larger than a short error message. Inspect event counts and transmitted event sizes, including existing SDK compression and the recently deployed ignore/sample rules. No causal link to the October 24–30 traffic decline is established.

## Smaller opportunities

The missing-days query ran 4,294,307 times, sending a date array and returning only 153,155 rows in aggregate. However, live DEFAULT_START_DAYS_AGO is 14. A typical inclusive 15-day array encodes to 196 bytes in node-postgres, only about 0.84 GB across this window, or a 5.43 GB/month / $0.81 scenario. Generating days from bounds inside Postgres can remove that array, but preserve the existing timezone/end-of-day semantics. This is not a major bill reduction at the present lookback.

The decimals lookup ran 7.13 million times. Caching successful low-change metadata can avoid complete requests, unlike merely narrowing selected columns. Cache keys, TTLs, invalidation for upgrades, missing-result behavior, and the value zero require care. Existing share-decimal caching elsewhere does not necessarily cover this lookup.

The monitor currently stores approximately 7.5 KB every ten seconds. If stable, JSON alone is about 1.94 GB/month. Moving to once per minute saves about 1.62 GB/month, roughly $0.24, plus SQL/protocol overhead. Redis count-only probes reduce private traffic and memory but do not directly address Render's public bandwidth charge.

Stored snapshot JSON averages 886 bytes for raw fields and 2,590 bytes for hooks across 4,379 rows. Stored merged rows are not outgoing patches, and unweighted entity averages are not write-weighted sizes. Do not multiply them by write count as a measured total. Snapshot diffs or deduplication need to preserve replays, ordering, omitted versus explicitly removed fields, nested metadata merging, concurrent writers, and block freshness. A server-side unchanged-row guard alone does not save bytes already sent.

## Measurement before infrastructure decisions

Collect a full indexing cycle plus idle time, then a matched 24-hour window. Count outgoing bytes by bounded destination category: Postgres, RPC provider, telemetry, webhook, other. Prefer process/socket counters once shell access is available. Otherwise use opt-in instrumentation of actual Postgres protocol writes and HTTP envelopes, recording lengths rather than payload contents. Do not export credentials, URLs containing tokens, calldata, exact addresses, or block ranges. Aggregate locally and account for instrumentation's own traffic.

Application plaintext/body counters omit some transport overhead and will not exactly equal Render's meter. Render's bandwidth graph has hourly points and approximately one-hour publication delay. Reconcile the categories with that total, alongside queue backlog, successful jobs, retries, index lag, and latest-block freshness. Do not claim savings by simply processing less work.

Verify the live BullMQ repeatable scheduler separately: checked-in ABI fanout has `start: false`, and persisted or externally created jobs can still drive production. Snapshot counters are consistent with frequent cycles but do not prove the exact configured cadence.

Only then compare hosting changes. A public same-region Neon address is not private networking. Render Private Link has a $30/month fixed charge plus $0.03/GB, so its Render-only marginal break-even versus $0.15 public traffic is about 250 GB/month while usage is above the allowance. Neon charges, plan requirements, return-direction traffic, and compatibility can change that result substantially.

Moving ingest alone can turn its currently free private Redis traffic into public datastore egress. Evaluate worker and queue placement together; include destination-side costs, reliability, and operational effort. Do not upgrade a workspace plan merely for included bandwidth unless the incremental subscription cost is below the avoided overage.

## Adversarial review and corrections

Claude Code Fable (`claude-fable-5-1`) completed a separate read-only review of the evidence and code before this recommendation order was published. Its main accepted correction was to avoid prioritizing repeated SQL as if it explained the whole network bill. Its duplicate TVL finding was verified directly, and the installed metric cardinality limit and compression default were checked.

The review itself also required corrections:

- Its estimated PostgreSQL share of ~25% is a scenario, not an upper bound or a measured destination split. SQL proxies omit parameter payloads and protocol costs, historical workload mix varies, and database counters combine clients. No “70% proven unexplained” bound is asserted.
- Decimals lookups do not imply the same number of persisted logs. A follow-up query found 40,620 `evmlog` insert/upsert calls since reset, far below 7.13 million decimals lookups. Event processing can filter or replay logs, and helpers have other callers.
- Contract metadata is not universally immutable; upgradeable contracts make indefinite caching unsafe. Use a finite TTL and invalidation policy.
- Snapshot getters are not all static, and there is no blanket static/dynamic split recommendation.
- TCP acknowledgement overhead may contribute to differences between application and network counters, but neither a fixed 2% factor nor its inclusion in Render's billing meter was verified. No savings estimate uses that claim.
- Neither the number of TVL jobs removed nor their fraction of total traffic has been measured. Sharing computation must preserve both output labels and existing price/block cache benefits.
- A bulk-write implementation is not automatically preferable to a smaller named-query change for an estimated ~$8/month SQL component. Correctness and implementation cost determine the choice.

The unresolved measurement gap is per-destination transmitted bytes. Render API access works, but SSH rejected the available key with `Permission denied (publickey)`. Application instrumentation can close that gap in a subsequent reviewed deployment; this audit did not deploy it.

## Local implementation and rollout

The first four priorities are implemented locally. No production settings or deployment have been changed.

- MQ inventory now uses queue, job, and bounded chain labels. OTLP metric exports default to 60 seconds; `OTEL_METRIC_EXPORT_INTERVAL_MS` accepts 10,000–300,000 milliseconds. Compression remains opt-in through the standard OTLP compression setting, after collector support is verified.
- Output writes use deterministic named prepared statements derived from the exact SQL. Transactions, row order, omitted columns, explicit NULLs, and post-commit cache invalidation are preserved. Other write paths remain unchanged.
- Compatible v2, v3, and ERC-4626 TVL hooks can share one observation calculation while retaining the legacy row and all five component rows. Missing-day coverage and unavailable-price guards remain label-specific. Tranche vaults retain only their existing `tvl-c` hook.
- RPC HTTP batch size and wait are bounded configuration options. Defaults remain size zero and wait zero. Positive sizes up to 100 and waits up to 100 milliseconds apply globally to the shared RPC clients; provider compatibility must be established before enabling them. Resolved URLs identify batch schedulers, including chain-default URLs.
- `OUTBOUND_BYTES_METRICS=true` enables `outbound.payload_bytes` with `destination=rpc|database`, plus `outbound.http_envelopes` for RPC. Node's Undici diagnostic event observes completed outgoing HTTP bodies, including batch envelopes and retries. PostgreSQL counting observes writes accepted by established client streams, including SQL and parameters; buffered writes can still fail later. Counters store lengths, not request contents or credentials.

These counters are partial attribution: they exclude HTTP headers, TLS/TCP overhead, PostgreSQL connection setup, Sentry, OTLP export traffic, webhooks, and other HTTP destinations. Redirected RPC bodies are omitted unless their destination is also registered. RPC attribution requires Node's Undici diagnostics; Bun fetch does not provide the same coverage. They are not billed wire-byte measurements and cannot alone reconcile the entire Render total. Endpoint matching is bounded to 64 registered RPC URLs per process.

For rollout, deploy the code with grouping and larger RPC batches disabled, then enable byte metrics alongside the existing bounded RPC attempt metrics. Compare complete indexing cycles and matched daily windows against Render egress, successful jobs, retries, queue backlog, and index freshness. Prepared writes and the lower-cardinality telemetry take effect with this code deployment, so a true before/after baseline requires capturing the prior revision as well.

Enable `TVL_GROUPED_JOBS=true` only after every extract consumer understands grouped payloads. The flag defaults to false and controls enqueueing; upgraded consumers always accept already-queued grouped jobs. To roll back to older code, first disable grouped enqueueing and drain grouped jobs with upgraded consumers, including failed jobs that might be retried. Older consumers understand only the first output label and would silently omit the second. Existing single-label jobs continue to work with the new code.

Trial RPC batching separately and start small after confirming every affected provider accepts it. Evaluate HTTP envelope count, logical attempts/retries, latency and freshness together; body bytes alone omit the header savings batching targets. Do not enable request compression for RPC providers based on the OTLP compression setting.

### Implementation verification

Luna's initial 57 targeted tests across 13 files passed, including real PostgreSQL output writes, TVL sharing/replays/legacy jobs, local HTTP byte comparisons/retries, and OTLP gzip. Full CI then exposed 12 existing mock-pool failures from unconditional listener registration; registration is now opt-in and has enabled/disabled coverage. Luna reran the full offline ingest suite: **264 tests passed, 44 skipped**, across 50 passing files. Live RPC tests were disabled for this run.

Ingest type checking and targeted lint passed. The repository typecheck-baseline gate also passes after removing the resolved ingest diagnostics. Direct lib type checking still reports its existing `packages/lib/vitest.setup.ts:10` diagnostic where `inject('testcontainers')` is typed as `never`; that existing error remains in the baseline. No baseline guard logic was weakened. Astra performed static review and did not run tests or lint.

Claude Code Fable (`claude-fable-5-1`) completed a separate read-only implementation review and found no blocking defects. Deployment still requires the documented grouped-consumer rollout and a Postgres connection that supports named prepared statements; the audit observed a direct Neon endpoint. MQ label changes and the default export cadence, as well as prepared output writes, take effect on code deployment.

## Sources

- [Render outbound bandwidth](https://render.com/docs/outbound-bandwidth)
- [Render service metrics](https://render.com/docs/service-metrics)
- [Render Private Link pricing](https://render.com/docs/private-link)
- [node-postgres prepared queries](https://node-postgres.com/features/queries)
- [OTLP exporter compression](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)
- Code: packages/ingest/load/index.ts, packages/ingest/db.ts, packages/ingest/fanout/timeseries.ts, packages/ingest/abis/yearn/lib/index.ts, packages/lib/rpcs.ts, packages/lib/mq.ts, packages/lib/metrics.ts, packages/ingest/probe/index.ts.
