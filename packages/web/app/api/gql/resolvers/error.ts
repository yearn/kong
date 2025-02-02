"use server";

import { bull } from "../../mq/bull";

export const q = {
  fanout: "fanout",
  extract: "extract",
  load: "load",
  probe: "probe",
};

export default async function getIndexingErrors() {
  const { Queue } = await import("bullmq");
  const result = [];
  for (const queue of Object.keys(q)) {
    const q = new Queue(queue, bull);
    const failed = await q.getJobs("failed");
    result.push(...failed);
  }
  return result;
}
