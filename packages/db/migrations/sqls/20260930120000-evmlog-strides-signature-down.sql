DELETE FROM evmlog_strides WHERE signature <> '';
ALTER TABLE evmlog_strides DROP CONSTRAINT evmlog_strides_pkey;
ALTER TABLE evmlog_strides ADD CONSTRAINT evmlog_strides_pkey PRIMARY KEY (chain_id, address);
ALTER TABLE evmlog_strides DROP COLUMN signature;
