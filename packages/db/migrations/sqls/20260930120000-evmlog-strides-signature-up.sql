ALTER TABLE evmlog_strides ADD COLUMN signature text NOT NULL DEFAULT '';
ALTER TABLE evmlog_strides DROP CONSTRAINT evmlog_strides_pkey;
ALTER TABLE evmlog_strides ADD CONSTRAINT evmlog_strides_pkey PRIMARY KEY (chain_id, address, signature);
