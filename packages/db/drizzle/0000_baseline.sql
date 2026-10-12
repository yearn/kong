CREATE TABLE "latest_block" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"block_number" numeric NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "block_pointer" (
	"pointer" text PRIMARY KEY NOT NULL,
	"block_number" numeric NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor" (
	"singleton" boolean PRIMARY KEY NOT NULL,
	"latest" json,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evmlog_strides" (
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"strides" text NOT NULL,
	CONSTRAINT "evmlog_strides_pkey" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "thing" (
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"label" text NOT NULL,
	"defaults" jsonb,
	CONSTRAINT "thing_pkey" PRIMARY KEY("chain_id","address","label")
);
--> statement-breakpoint
CREATE TABLE "snapshot" (
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"snapshot" jsonb,
	"hook" jsonb,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone,
	CONSTRAINT "snapshot_pkey" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "price" (
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"price_usd" numeric NOT NULL,
	"price_source" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	CONSTRAINT "price_pkey" PRIMARY KEY("chain_id","address","block_number")
);
--> statement-breakpoint
CREATE TABLE "output" (
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"label" text NOT NULL,
	"component" text NOT NULL,
	"value" numeric,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"series_time" timestamp with time zone NOT NULL,
	CONSTRAINT "output_pkey" PRIMARY KEY("chain_id","address","label","component","series_time")
);
--> statement-breakpoint
CREATE TABLE "evmlog" (
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"event_name" text NOT NULL,
	"signature" text NOT NULL,
	"topics" text[] NOT NULL,
	"args" jsonb,
	"hook" jsonb,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone,
	"log_index" integer NOT NULL,
	"transaction_hash" text NOT NULL,
	"transaction_index" integer NOT NULL,
	CONSTRAINT "evmlog_pkey" PRIMARY KEY("chain_id","address","signature","block_number","log_index","transaction_hash")
);
--> statement-breakpoint
SELECT create_hypertable('output', 'series_time');
--> statement-breakpoint
CREATE INDEX "evmlog_idx_chain_signature_args_vault" ON "evmlog" USING btree ("chain_id", "signature", ((args ->> 'vault'::text))) WHERE (args ? 'vault'::text);
--> statement-breakpoint
CREATE INDEX "idx_output_chain_address_label_series_time" ON "output" USING btree ("chain_id", "address", "label", "series_time" DESC);
--> statement-breakpoint
CREATE INDEX "idx_output_chain_id_address" ON "output" USING btree ("chain_id", "address");
--> statement-breakpoint
CREATE INDEX "idx_output_label_component_block_time" ON "output" USING btree ("label", "component", "block_time" DESC);
--> statement-breakpoint
CREATE INDEX "idx_thing_chain_id_address_defaults" ON "thing" USING btree ("chain_id", "address") WHERE ((defaults ->> 'yearn'::text) = 'true'::text);
--> statement-breakpoint
CREATE INDEX "thing_idx_chain_id_label" ON "thing" USING btree ("chain_id", "label");
--> statement-breakpoint
CREATE INDEX "thing_idx_label" ON "thing" USING btree ("label");
--> statement-breakpoint
CREATE TABLE "sync_checkpoint" (
	"sync_id" text NOT NULL,
	"worker_id" integer NOT NULL,
	"last_series_time" timestamp,
	"records_synced" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	CONSTRAINT "sync_checkpoint_pkey" PRIMARY KEY("sync_id","worker_id")
);
--> statement-breakpoint
CREATE INDEX "evmlog_event_chain_time_idx" ON "evmlog" USING btree ("event_name", "chain_id", "block_time" DESC, "log_index" DESC);
--> statement-breakpoint
CREATE INDEX "evmlog_idx_chain_addr_event_block" ON "evmlog" USING btree ("chain_id", "address", "event_name", "block_number", "log_index");
--> statement-breakpoint
CREATE INDEX "evmlog_idx_event_name" ON "evmlog" USING btree ("event_name");
--> statement-breakpoint
CREATE INDEX "idx_evmlog_chain_sig_block" ON "evmlog" USING btree ("chain_id", "signature", "block_number" DESC, "log_index" DESC);
--> statement-breakpoint
CREATE INDEX "output_chain_addr_label_blocktime_idx" ON "output" USING btree ("chain_id", "address", "label", "block_time" DESC);
--> statement-breakpoint
CREATE INDEX "output_chain_label_component_time_idx" ON "output" USING btree ("chain_id", "label", "component", "block_time" DESC);
--> statement-breakpoint
CREATE INDEX "price_chain_addr_time_idx" ON "price" USING btree ("chain_id", "address", "block_time");
