import { mq } from "..";

export default async function getErrors() {
  const result = [];
  for (const queue of Object.keys(mq.q)) {
    const q = mq.connect(queue);
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
  return result;
}
