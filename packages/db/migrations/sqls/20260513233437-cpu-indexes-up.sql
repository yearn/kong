-- CPU cost reduction indexes.
-- See docs/cpu-cost-analysis.md.
--
-- evmlog: a (chain_id, signature, block_number DESC, log_index DESC) index
-- already exists in prod as idx_evmlog_chain_sig_block, so the generic
-- chain+signature index this migration originally added would be an exact
-- duplicate and is omitted (IF NOT EXISTS does not catch the different name).
-- The partial expression index below stays: it serves the NewDebtAllocator
-- lookup by vault (projectDebtAllocator), which filters args->>'vault' and is
-- not a direct seek under the block-ordered index.
--
-- output: hot "latest snapshot" patterns filter by (chain_id, address, label).
-- idx_output_chain_id_address stops at (chain_id, address). Adding label and
-- series_time DESC lets Timescale prune chunks and serve "max series_time per
-- key" via index-only scans. The existing output(chain_id, address, label,
-- block_time DESC) index is keyed on block_time, which does not give chunk
-- exclusion; series_time does.

CREATE INDEX IF NOT EXISTS evmlog_idx_chain_signature_args_vault
  ON evmlog (chain_id, signature, (args->>'vault'))
  WHERE args ? 'vault';

CREATE INDEX IF NOT EXISTS idx_output_chain_address_label_series_time
  ON output (chain_id, address, label, series_time DESC);
