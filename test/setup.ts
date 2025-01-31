import { rpcs } from "../packages/lib/rpcs";

// Initialize RPC clients
await rpcs.up();
// Configure BigInt serialization for tests
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
