-- CPU cost reduction indexes.
-- See docs/cpu-cost-analysis.md.
--
-- evmlog: PK is (chain_id, address, signature, …). Queries that filter by
-- (chain_id, signature) without address (projectDebtAllocator and friends)
-- end up scanning the whole table. Index #1 below fixes that.
--
-- Index #2 is a partial expression index for the hottest query
-- (NewDebtAllocator lookup by vault), which filters args->>'vault'.
--
-- output: hot "latest snapshot" / "distinct block_time" patterns filter by
-- (chain_id, address, label). idx_output_chain_id_address stops at (chain_id,
-- address). Adding label and series_time DESC lets Timescale prune chunks
-- and serve "max series_time per key" via index-only scans.

CREATE INDEX IF NOT EXISTS evmlog_idx_chain_signature
  ON evmlog (chain_id, signature, block_number DESC, log_index DESC);

CREATE INDEX IF NOT EXISTS evmlog_idx_chain_signature_args_vault
  ON evmlog (chain_id, signature, (args->>'vault'))
  WHERE args ? 'vault';

CREATE INDEX IF NOT EXISTS idx_output_chain_address_label_series_time
  ON output (chain_id, address, label, series_time DESC);
