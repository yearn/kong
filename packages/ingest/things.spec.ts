import { expect } from "chai";
import { types } from "lib";
import { get, exist } from "./things";
import { upsertBatch } from "./load";
import db from "./db";
import { describe, it, beforeEach, afterEach } from "bun:test";

describe("things", function () {
  let things: types.Thing[];
  beforeEach(async function () {
    const thinglet = { chainId: 1, label: "vault" };
    things = [] as types.Thing[];
    things.push(
      ...[
        {
          ...thinglet,
          address: "0x1",
          defaults: { apiVersion: "1.0.0" },
        } as types.Thing,
        {
          ...thinglet,
          address: "0x2",
          defaults: { apiVersion: "2.0.0" },
        } as types.Thing,
        {
          ...thinglet,
          address: "0x3",
          defaults: { apiVersion: "3.0.0" },
        } as types.Thing,
        {
          ...thinglet,
          address: "0x4",
          defaults: { apiVersion: "4.0.0" },
        } as types.Thing,
        {
          ...thinglet,
          address: "0x5",
          defaults: { label: "mushi" },
        } as types.Thing,
      ]
    );
    await upsertBatch(things, "thing", "chain_id, address, label");
  });

  afterEach(async function () {
    for (const thing of things) {
      await db.query(
        "DELETE FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3",
        [thing.chainId, thing.address, thing.label]
      );
    }
  });

  it("gets things >= apiVersion", async function () {
    const things = await get({
      label: "vault",
      filter: [{ field: "apiVersion", op: ">=", value: "3.0.0" }],
      skip: false,
      only: false,
    });

    expect(things.length).to.equal(2);
    expect(things[0].address).to.equal("0x3");
    expect(things[1].address).to.equal("0x4");
  });

  it("gets things > and <= apiVersion", async function () {
    const things = await get({
      label: "vault",
      filter: [
        { field: "apiVersion", op: ">", value: "1.0.0" },
        { field: "apiVersion", op: "<=", value: "3.0.0" },
      ],
      skip: false,
      only: false,
    });

    expect(things.length).to.equal(2);
    expect(things[0]).to.deep.equal(things[1]);
    expect(things[1]).to.deep.equal(things[2]);
  });

  it("gets things by label", async function () {
    const things = await get({
      label: "vault",
      filter: [{ field: "label", op: "=", value: "mushi" }],
      skip: false,
      only: false,
    });

    expect(things.length).to.equal(1);
    expect(things[0]).to.deep.equal(things[4]);
  });

  it("gets things by ~label", async function () {
    const things = await get({
      label: "vault",
      filter: [{ field: "label", op: "!=", value: "mushi" }],
      skip: false,
      only: false,
    });

    expect(things.length).to.equal(4);
    expect(things).to.deep.equal(things.slice(0, 4));
  });

  it("knows if things exist", async function () {
    expect(await exist(1, "0x1", "vault")).to.be.true;
    expect(await exist(1, "0xNaN", "vault")).to.be.false;
  });
});
