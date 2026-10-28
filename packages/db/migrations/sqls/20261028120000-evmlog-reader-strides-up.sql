-- Legacy address coverage cannot establish which ABI was processed.
-- Keep the old table for old workers; readers conservatively start uncovered.
CREATE TABLE evmlog_reader_strides (
  chain_id integer NOT NULL,
  address text NOT NULL,
  abi_path text NOT NULL,
  strides text NOT NULL,
  PRIMARY KEY (chain_id, address, abi_path)
);
