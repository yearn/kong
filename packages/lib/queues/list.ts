import { mq } from "..";
import chains from "../chains";

export async function getQueues() {
  const result = {} as { [key: string]: number };
  for (const queue of Object.keys(mq.q)) {
    const q = mq.connect(queue);
    result[queue] = (await q.getJobs("failed")).length;
    await q.close();
  }

  for (const chain of chains) {
    const queue = `extract-${chain.id}`;
    const q = mq.connect(queue);
    result[queue] = (await q.getJobs("failed")).length;
    await q.close();
  }

  return result;
}
