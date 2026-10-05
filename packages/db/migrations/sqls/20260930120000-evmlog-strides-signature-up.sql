-- Stop all old ingest workers and drain their jobs before applying this migration.
-- Their address-only ON CONFLICT target is incompatible with the new primary key.
DO $$ BEGIN
  IF current_setting('kong.signature_migration_workers_stopped', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Stop and drain old ingest workers; explicitly set kong.signature_migration_workers_stopped=on before migrating';
  END IF;
END; $$;

ALTER TABLE evmlog_strides ADD COLUMN signature text NOT NULL DEFAULT '';
ALTER TABLE evmlog_strides DROP CONSTRAINT evmlog_strides_pkey;
ALTER TABLE evmlog_strides ADD CONSTRAINT evmlog_strides_pkey PRIMARY KEY (chain_id, address, signature);
ALTER TABLE evmlog_strides ALTER COLUMN signature DROP DEFAULT;

CREATE INDEX evmlog_strides_legacy_address_idx ON evmlog_strides(chain_id, lower(address)) WHERE signature = '';
CREATE INDEX thing_lower_address_idx ON thing(chain_id, lower(address));
