CREATE TABLE block_pointer (
	pointer text NOT NULL,
	block_number numeric NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT block_pointer_pkey PRIMARY KEY (pointer)
);
