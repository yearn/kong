import { sql } from 'drizzle-orm'
import { bigint, boolean, index, integer, json, jsonb, numeric, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const latestBlock = pgTable('latest_block', {
  chainId: integer('chain_id').primaryKey().notNull(),
  blockNumber: numeric('block_number').notNull(),
  blockTime: timestamp('block_time', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
})

export const blockPointer = pgTable('block_pointer', {
  pointer: text().primaryKey().notNull(),
  blockNumber: numeric('block_number').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
})

export const monitor = pgTable('monitor', {
  singleton: boolean().primaryKey().notNull(),
  latest: json(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
})

export const evmlogStrides = pgTable('evmlog_strides', {
  chainId: integer('chain_id').notNull(),
  address: text().notNull(),
  strides: text().notNull(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.address], name: 'evmlog_strides_pkey'}),
])

export const thing = pgTable('thing', {
  chainId: integer('chain_id').notNull(),
  address: text().notNull(),
  label: text().notNull(),
  defaults: jsonb(),
}, (table) => [
  index('idx_thing_chain_id_address_defaults').using('btree', table.chainId.asc().nullsLast(), table.address.asc().nullsLast()).where(sql`((defaults ->> 'yearn'::text) = 'true'::text)`),
  index('thing_idx_chain_id_label').using('btree', table.chainId.asc().nullsLast(), table.label.asc().nullsLast()),
  index('thing_idx_label').using('btree', table.label.asc().nullsLast()),
  primaryKey({ columns: [table.chainId, table.address, table.label], name: 'thing_pkey'}),
])

export const snapshot = pgTable('snapshot', {
  chainId: integer('chain_id').notNull(),
  address: text().notNull(),
  snapshot: jsonb(),
  hook: jsonb(),
  blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  blockTime: timestamp('block_time', { withTimezone: true, mode: 'string' }),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.address], name: 'snapshot_pkey'}),
])

export const price = pgTable('price', {
  chainId: integer('chain_id').notNull(),
  address: text().notNull(),
  priceUsd: numeric('price_usd').notNull(),
  priceSource: text('price_source').notNull(),
  blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  blockTime: timestamp('block_time', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  index('price_chain_addr_time_idx').using('btree', table.chainId.asc().nullsLast(), table.address.asc().nullsLast(), table.blockTime.asc().nullsLast()),
  primaryKey({ columns: [table.chainId, table.address, table.blockNumber], name: 'price_pkey'}),
])

export const output = pgTable('output', {
  chainId: integer('chain_id').notNull(),
  address: text().notNull(),
  label: text().notNull(),
  component: text().notNull(),
  value: numeric(),
  blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  blockTime: timestamp('block_time', { withTimezone: true, mode: 'string' }).notNull(),
  seriesTime: timestamp('series_time', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  index('idx_output_chain_address_label_series_time').using('btree', table.chainId.asc().nullsLast(), table.address.asc().nullsLast(), table.label.asc().nullsLast(), table.seriesTime.desc().nullsFirst()),
  index('idx_output_chain_id_address').using('btree', table.chainId.asc().nullsLast(), table.address.asc().nullsLast()),
  index('idx_output_label_component_block_time').using('btree', table.label.asc().nullsLast(), table.component.asc().nullsLast(), table.blockTime.desc().nullsFirst()),
  index('output_series_time_idx').using('btree', table.seriesTime.desc().nullsFirst()),
  index('output_chain_addr_label_blocktime_idx').using('btree', table.chainId.asc().nullsLast(), table.address.asc().nullsLast(), table.label.asc().nullsLast(), table.blockTime.desc().nullsFirst()),
  index('output_chain_label_component_time_idx').using('btree', table.chainId.asc().nullsLast(), table.label.asc().nullsLast(), table.component.asc().nullsLast(), table.blockTime.desc().nullsFirst()),
  primaryKey({ columns: [table.chainId, table.address, table.label, table.component, table.seriesTime], name: 'output_pkey'}),
])

export const evmlog = pgTable('evmlog', {
  chainId: integer('chain_id').notNull(),
  address: text().notNull(),
  eventName: text('event_name').notNull(),
  signature: text().notNull(),
  topics: text().array().notNull(),
  args: jsonb(),
  hook: jsonb(),
  blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  blockTime: timestamp('block_time', { withTimezone: true, mode: 'string' }),
  logIndex: integer('log_index').notNull(),
  transactionHash: text('transaction_hash').notNull(),
  transactionIndex: integer('transaction_index').notNull(),
}, (table) => [
  index('evmlog_idx_chain_signature_args_vault').using('btree', sql`chain_id`, sql`signature`, sql`((args ->> 'vault'::text))`).where(sql`(args ? 'vault'::text)`),
  index('evmlog_event_chain_time_idx').using('btree', table.eventName.asc().nullsLast(), table.chainId.asc().nullsLast(), table.blockTime.desc().nullsFirst(), table.logIndex.desc().nullsFirst()),
  index('evmlog_idx_chain_addr_event_block').using('btree', table.chainId.asc().nullsLast(), table.address.asc().nullsLast(), table.eventName.asc().nullsLast(), table.blockNumber.asc().nullsLast(), table.logIndex.asc().nullsLast()),
  index('evmlog_idx_event_name').using('btree', table.eventName.asc().nullsLast()),
  index('idx_evmlog_chain_sig_block').using('btree', table.chainId.asc().nullsLast(), table.signature.asc().nullsLast(), table.blockNumber.desc().nullsFirst(), table.logIndex.desc().nullsFirst()),
  primaryKey({ columns: [table.chainId, table.address, table.signature, table.blockNumber, table.logIndex, table.transactionHash], name: 'evmlog_pkey'}),
])

export const syncCheckpoint = pgTable('sync_checkpoint', {
  syncId: text('sync_id').notNull(),
  workerId: integer('worker_id').notNull(),
  lastSeriesTime: timestamp('last_series_time', { mode: 'string' }),
  recordsSynced: bigint('records_synced', { mode: 'number' }).default(0).notNull(),
  startedAt: timestamp('started_at', { mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull(),
  status: text().notNull(),
  errorMessage: text('error_message'),
}, (table) => [
  primaryKey({ columns: [table.syncId, table.workerId], name: 'sync_checkpoint_pkey'}),
])
