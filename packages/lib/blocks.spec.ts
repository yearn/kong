import { test, expect } from "bun:test";
import { __estimateHeight } from "./blocks";

test("estimates block height", async () => {
  const result = await __estimateHeight(1, 1716356553n);
  const ranged = result >= 19923410n && result <= 19923414n;
  if (!ranged) console.error("result", result);
  expect(ranged).toBe(true);
});
