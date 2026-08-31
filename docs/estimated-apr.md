# Estimated APR

This document tells how kong makes `performance.estimated` from publisher output rows.

## Emission model

An external publisher sends APR data to kong through a webhook. The publisher sends one
row for each component. Each row has a `chain_id`, an `address`, a `label`, a
`component` name and a numeric `value`. Kong writes the rows into the `output` table.

The label tells which publisher sent the row. Kong finds vault-level estimates with a
label that ends in `-estimated-apr` (`packages/lib/estimated-apr.ts:74`).

One group of rows with the same chain, address, label and `block_time` is one emission.
Kong reads the most recent emission and makes one `estimated` object from it.

## Reserved components

Kong promotes some component names to the top level of the `estimated` object. The
other components stay in `components`.

| Component | Result | Note |
|-----------|--------|------|
| `netAPR` | promoted to `apr` | net of all fees |
| `netAPY` | promoted to `apy` | net of all fees |
| `grossAPR` | promoted to `grossAPR` | before fees |
| `grossAPY` | promoted to `grossAPY` | before fees |
| `compoundingPeriodsPerYear` | stays in `components` | not an APR |
| `isStrategy` | stays in `components` | scope marker, see below |
| `debtRatio` | stays in `components` | not an APR, legacy scope marker |

## Promotion rules

`promoteEstimatedApr` does the promotion (`packages/ingest/helpers/apy-apr.ts:9`). Both
the vault path (`packages/ingest/helpers/apy-apr.ts:34`) and the strategy composition
path (`packages/ingest/abis/yearn/3/vault/snapshot/hook.ts:465`) use it.

- `apr` and `apy` come from `netAPR` and `netAPY` only. Kong never puts a gross value
  into `apr` or `apy`.
- If the publisher sends no `netAPR`, `apr` is absent. Kong does not write a zero.
- A promoted component is removed from `components`
  (`packages/ingest/helpers/apy-apr.ts:10`).
- A row with a null value is not promoted and does not go into `components`.

The schema `EstimatedAprSchema` holds the promoted shape
(`packages/lib/types.ts:444`). The REST list schema
(`packages/web/app/api/rest/list/db.ts:48`) and the GraphQL type
(`packages/web/app/api/gql/typeDefs/vault.ts:129`) hold the same fields.

## Scope resolution

A publisher can send an estimate for a vault or for a strategy. The `thing` table cannot
tell the two apart, because one address can be a v3 vault and a strategy of a different
vault at the same time (issue #409). Only the publisher knows the scope of each
emission.

Kong finds the scope from the emission itself
(`packages/lib/estimated-apr.ts:78`):

1. If the emission has a non-zero `isStrategy` component, the emission is
   strategy-scoped.
2. If the emission has no `isStrategy` component, and it has a `debtRatio` component,
   the emission is strategy-scoped. This is the legacy rule.
3. In all other conditions the emission is vault-scoped.

The unlabeled lookup returns vault-scoped emissions only. This keeps a strategy APR out
of the parent vault `performance.estimated` (issue #409, issue #410).

The lookup with an explicit label does not apply the scope rule
(`packages/lib/estimated-apr.ts:64`). The vault composition path uses that lookup, so a
strategy estimate stays available for the composition entry.

An emission that has neither marker is vault-scoped. Thus a net-only emission keeps its
current scope (issue #443).

## Legacy publisher components

These publishers were in operation before the gross and net split. Their component names
do not always agree with the meaning of the value.

| Publisher label | Component | True meaning |
|-----------------|-----------|--------------|
| `katana-estimated-apr` (strategy) | `netAPR` | gross, not net |
| `katana-estimated-apr` (strategy) | `netAPY` | gross, not net |
| `katana-estimated-apr` | `katRewardsAPR` | gross; not in `netAPR` and not in `grossAPR` |
| `crv-estimated-apr` | `netAPR` | net, but on an APY basis |
| `velo-estimated-apr` | `netAPR` | net, but on an APY basis |
| `aero-estimated-apr` | `netAPR` | net, but on an APY basis |
| `yvusd-estimated-apr` | `baseNetAPR` | net leg of the total |
| `yvusd-estimated-apr` | `lockerBonusAPR` | net leg of the total |
| any | `debtRatio` | not an APR; a debt allocation in basis points |

Kong does not correct these values. Kong promotes what the publisher sends.
