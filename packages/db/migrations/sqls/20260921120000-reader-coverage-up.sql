-- Coverage is reader-specific. Existing rows predate reader identity and must
-- remain available only as unattributed legacy coverage.
ALTER TABLE evmlog_strides
  ADD COLUMN abi_path text NOT NULL DEFAULT '__legacy__';

-- Keep the default only long enough to backfill existing rows. Every live
-- reader must provide its identity explicitly after this migration.
ALTER TABLE evmlog_strides
  ALTER COLUMN abi_path DROP DEFAULT;

ALTER TABLE evmlog_strides
  ADD CONSTRAINT evmlog_strides_abi_path_not_empty CHECK (abi_path <> '');

ALTER TABLE evmlog_strides
  DROP CONSTRAINT evmlog_strides_pkey;

ALTER TABLE evmlog_strides
  ADD CONSTRAINT evmlog_strides_pkey PRIMARY KEY (chain_id, address, abi_path);
