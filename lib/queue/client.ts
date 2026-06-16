/**
 * BullMQ Queue Client
 *
 * Provides the DM processing queue and Redis connection for BullMQ.
 */

import { Queue } from "bullmq";
import Redis from "ioredis";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    const url = process.env.REDIS_URL!;
    const isTls = url.startsWith("rediss://");
    connection = new Redis(url, {
      maxRetriesPerRequest: null, // Required by BullMQ
      ...(isTls && { tls: {} }),
    });
  }
  return connection;
}

// ─── DM Queue ───────────────────────────────────────────────────────────────────

export interface ProcessCommentJob {
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  requeueAttempt?: number;
}

export interface ProcessPostbackJob {
  instagramAccountId: string;
  senderIgsid: string;
  automationId: string;
}

export type AnyDMJob = ProcessCommentJob | ProcessPostbackJob;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dmQueue: Queue<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDMQueue(): Queue<any> {
  if (!dmQueue) {
    dmQueue = new Queue("dm-processing", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 }, // Keep last 1000 completed jobs
        removeOnFail: { count: 5000 }, // Keep last 5000 failed jobs
        attempts: 3,
        backoff: {
          type: "custom",
        },
      },
    });
  }
  return dmQueue;
}
