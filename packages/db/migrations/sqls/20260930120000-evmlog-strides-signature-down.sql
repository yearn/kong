-- Refuse to silently discard adopted signature coverage. Restore a reviewed
-- address-level coverage snapshot before rolling back with old workers stopped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM evmlog_strides WHERE signature <> '') THEN
    RAISE EXCEPTION 'Cannot roll back signature coverage: restore conservative address-level coverage first';
  END IF;
END
$$;
ALTER TABLE evmlog_strides DROP CONSTRAINT evmlog_strides_pkey;
ALTER TABLE evmlog_strides ADD CONSTRAINT evmlog_strides_pkey PRIMARY KEY (chain_id, address);
ALTER TABLE evmlog_strides DROP COLUMN signature;
