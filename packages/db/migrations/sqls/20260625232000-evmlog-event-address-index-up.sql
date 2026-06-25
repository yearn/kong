CREATE INDEX CONCURRENTLY IF NOT EXISTS evmlog_idx_chain_address_event_block
  ON evmlog (chain_id, address, event_name, block_number, log_index);
