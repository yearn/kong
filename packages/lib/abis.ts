import { z } from "zod";
import * as yaml from "js-yaml";
import * as fs from "fs";
import path from "path";
import { keccak256, toBytes } from "viem";
import { zhexstring } from "./types";
import { CronSchema } from "./crons";

export const SourceConfigSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  inceptBlock: z.bigint({ coerce: true }),
  skip: z.boolean().optional().default(false),
  only: z.boolean().optional().default(false),
  startBlock: z.bigint({ coerce: true }).optional(),
  endBlock: z.bigint({ coerce: true }).optional(),
});

export type SourceConfig = z.infer<typeof SourceConfigSchema>;

const ThingFilterSchema = z.object({
  field: z.string(),
  op: z.string(),
  value: z.string(),
});

export const ThingsConfigSchema = z.object({
  label: z.string(),
  filter: ThingFilterSchema.array(),
  skip: z.boolean().optional().default(false),
  only: z.boolean().optional().default(false),
});

export type ThingsConfig = z.infer<typeof ThingsConfigSchema>;

export const AbiConfigSchema = z.object({
  abiPath: z.string(),
  sources: SourceConfigSchema.array().optional().default([]),
  things: ThingsConfigSchema.optional(),
  skip: z.boolean().optional().default(false),
  only: z.boolean().optional().default(false),
});

export type AbiConfig = z.infer<typeof AbiConfigSchema>;

const YamlConfigSchema = z.object({
  cron: CronSchema,
  abis: z.array(AbiConfigSchema),
});

const yamlPath = (() => {
  const local = path.join(__dirname, "../../config", "abis.local.yaml");
  const production = path.join(__dirname, "../../config", "abis.yaml");
  if (fs.existsSync(local)) return local;
  return production;
})();

const yamlFile = fs.readFileSync(yamlPath, "utf8");
const config = YamlConfigSchema.parse(yaml.load(yamlFile));
const allAbis = config.abis.map((abi) => ({
  ...abi,
  id: keccak256(
    toBytes(
      JSON.stringify(abi, (_, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    )
  ),
}));

const cron = config.cron;
const abis = prune(allAbis);

export { abis, cron };

export function prune(abis: AbiConfig[]): AbiConfig[] {
  const copy = AbiConfigSchema.array().parse(
    JSON.parse(
      JSON.stringify(abis, (_, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    )
  );
  const someSourceOnly = copy.some((abi) =>
    abi.sources.some((source) => source.only)
  );
  const someThingOnly = copy.some((abi) => abi.things?.only);

  let result = copy.map((abi) => ({
    ...abi,
    sources: abi.sources.filter(
      (source) =>
        !source.skip &&
        (abi.only || source.only || !(someSourceOnly || someThingOnly))
    ),
    things:
      abi.things &&
      !abi.things.skip &&
      (abi.only || abi.things.only || !(someSourceOnly || someThingOnly))
        ? {
            ...abi.things,
          }
        : undefined,
  }));

  return result.filter(
    (abi) =>
      !abi.skip &&
      (abi.sources.length > 0 || abi.things !== undefined) &&
      (abi.only ||
        abi.sources.some((source) => source.only) ||
        abi.things?.only ||
        !copy.some((c) => c.only))
  );
}
