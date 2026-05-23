import { createDMWorker } from "@/lib/queue/dm-worker";

const worker = createDMWorker();

console.log("[DM Worker] Started");

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
