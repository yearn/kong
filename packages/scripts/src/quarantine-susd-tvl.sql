\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply 0
\endif

BEGIN;

CREATE TEMP TABLE bad ON COMMIT DROP AS
SELECT DISTINCT label, series_time
FROM output
WHERE chain_id = 1
  AND address = '0x5a770DbD3Ee6bAF2802D29a901Ef11501C44797A'
  AND label IN ('tvl', 'tvl-c')
  AND series_time >= '2026-11-06'
  AND ((component = 'priceUsd' AND value > 100) OR (component = 'tvl' AND value > 1000000));

SELECT o.label, o.component, o.series_time, o.block_number, o.value AS old_value
FROM output o
JOIN bad b ON b.label = o.label AND b.series_time = o.series_time
WHERE o.chain_id = 1
  AND o.address = '0x5a770DbD3Ee6bAF2802D29a901Ef11501C44797A'
ORDER BY o.series_time, o.label, o.component;

UPDATE output o
SET value = NULL
FROM bad b
WHERE o.chain_id = 1
  AND o.address = '0x5a770DbD3Ee6bAF2802D29a901Ef11501C44797A'
  AND o.label = b.label
  AND o.series_time = b.series_time
  AND o.component IN ('tvl', 'delegated', 'priceUsd')
  AND o.value IS NOT NULL
RETURNING o.label, o.component, o.series_time;

\if :apply
COMMIT;
\else
ROLLBACK;
\endif
