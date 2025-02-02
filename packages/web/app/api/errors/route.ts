import { Queue } from "bullmq";
import { bull } from "../mq/bull";

// do something with this later
export const q = {
  fanout: "fanout",
  extract: "extract",
  load: "load",
  probe: "probe",
};

export async function GET() {
  const result = [];
  for (const queue of Object.keys(q)) {
    const q = new Queue(queue, bull);
    const failed = await q.getJobs("failed");
    for (const job of failed) {
      result.push({
        queue: job.queueName,
        stacktrace: job.stacktrace,
        failedReason: job.failedReason,
        data: job.data,
      });
    }
  }
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}
