-- Reader-specific rows cannot be merged back into one address-wide row without
-- claiming that every reader covered the union of their ranges.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM evmlog_strides
    WHERE abi_path IS DISTINCT FROM '__legacy__'
  ) THEN
    RAISE EXCEPTION
      'Cannot roll back evmlog_strides while reader-specific coverage rows exist';
  END IF;
END;
$$;

ALTER TABLE evmlog_strides
  DROP CONSTRAINT evmlog_strides_pkey;

ALTER TABLE evmlog_strides
  DROP COLUMN abi_path;

ALTER TABLE evmlog_strides
  ADD CONSTRAINT evmlog_strides_pkey PRIMARY KEY (chain_id, address);
