ALTER TABLE vault ADD COLUMN emergency_shutdown boolean NULL;

ALTER TABLE vault ADD COLUMN profit_max_unlock_time numeric NULL;
ALTER TABLE vault ADD COLUMN profit_unlocking_rate numeric NULL;
ALTER TABLE vault ADD COLUMN full_profit_unlock_date numeric NULL;
ALTER TABLE vault ADD COLUMN last_profit_update numeric NULL;
ALTER TABLE vault ADD COLUMN total_idle numeric NULL;
ALTER TABLE vault ADD COLUMN minimum_total_idle numeric NULL;
ALTER TABLE vault ADD COLUMN accountant text NULL;
ALTER TABLE vault ADD COLUMN role_manager text NULL;
ALTER TABLE vault ADD COLUMN debt_manager text NULL;
ALTER TABLE vault ADD COLUMN is_shutdown boolean NULL;

ALTER TABLE harvest ADD COLUMN protocol_fees numeric NULL;
ALTER TABLE harvest ADD COLUMN protocol_fees_usd numeric NULL;
ALTER TABLE harvest ADD COLUMN performance_fees numeric NULL;
ALTER TABLE harvest ADD COLUMN performance_fees_usd numeric NULL;

CREATE TABLE vault_debt (
	chain_id integer NOT NULL,
	lender text NOT NULL,
	borrower text NOT NULL,
	max_debt numeric NOT NULL,
	current_debt numeric NOT NULL,
	current_debt_ratio numeric NOT NULL,
	target_debt_ratio numeric NULL,
	max_debt_ratio numeric NULL,
	block_number numeric NOT NULL,
	block_time timestamptz NOT NULL,
	CONSTRAINT vault_debt_pkey PRIMARY KEY (chain_id, lender, borrower)
);

ALTER TABLE block_pointer DROP CONSTRAINT block_pointer_pkey;
UPDATE block_pointer SET address = chain_id::text || '/' || address;
ALTER TABLE block_pointer RENAME COLUMN address TO pointer;
ALTER TABLE block_pointer DROP COLUMN chain_id;
ALTER TABLE block_pointer ADD CONSTRAINT block_pointer_pkey PRIMARY KEY (pointer);

DROP VIEW vault_gql;
DROP VIEW strategy_gql;

ALTER TABLE vault DROP COLUMN as_of_block_number;
ALTER TABLE strategy DROP COLUMN as_of_block_number;
ALTER TABLE withdrawal_queue DROP COLUMN as_of_block_number;
ALTER TABLE strategy_lender_status DROP COLUMN as_of_block_number;

CREATE VIEW vault_gql AS
SELECT 
	v.*,
	erc20.meta_description AS asset_description,
	t.price_usd AS asset_price_usd,
	t.price_source AS asset_price_source,
	t.tvl_usd AS tvl_usd,
	a.net AS apy_net,
	a.weekly_net AS apy_weekly_net,
	a.monthly_net AS apy_monthly_net,
	a.inception_net AS apy_inception_net,
	a.gross_apr AS apr_gross
FROM vault v
JOIN erc20 
	ON v.chain_id = erc20.chain_id 
	AND v.asset_address = erc20.address
LEFT JOIN LATERAL (
	SELECT 
		price_usd,
		price_source,
		tvl_usd
	FROM tvl
	WHERE v.chain_id = tvl.chain_id AND v.address = tvl.address
	ORDER BY block_time DESC
	LIMIT 1
) t ON TRUE
LEFT JOIN LATERAL (
	SELECT 
		net,
		weekly_net,
		monthly_net,
		inception_net,
		gross_apr
	FROM apy
	WHERE v.chain_id = apy.chain_id AND v.address = apy.address
	ORDER BY block_time DESC
	LIMIT 1
) a ON TRUE;

CREATE VIEW strategy_gql AS
SELECT 
	s.*,
	a.gross AS gross_apr,
	a.net AS net_apr
FROM strategy s
LEFT JOIN LATERAL (
	SELECT 
		gross,
		net
	FROM apr
	WHERE s.chain_id = apr.chain_id AND s.address = apr.address
	ORDER BY block_time DESC
	LIMIT 1
) a ON TRUE;
