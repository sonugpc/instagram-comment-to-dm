import { Worker, type Job } from "bullmq";
import { getDMQueue, getRedisConnection, type ProcessCommentJob } from "./client";
import { prisma } from "@/lib/db/client";
import { MetaApiError, sendPrivateReply } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { checkRateLimit, incrementDMCounter } from "@/lib/utils/rate-limiter";
import {
  canSendDMForWorkspace,
  incrementWorkspaceDMUsage,
} from "@/lib/billing/usage";

const BACKOFF_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000];

function formatError(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `Meta API Error ${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

async function processComment(job: Job<ProcessCommentJob>): Promise<void> {
  const {
    instagramAccountId,
    commentId,
    commentText,
    commenterId,
    commenterName,
    mediaId,
  } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;

  const automations = await prisma.automation.findMany({
    where: {
      postId: mediaId,
      isActive: true,
      instagramAccount: {
        instagramId: instagramAccountId,
      },
    },
    include: {
      instagramAccount: true,
      workspace: true,
    },
    orderBy: { createdAt: "asc" },
  });

  for (const automation of automations) {
    const matchResult = matchKeywords(
      commentText,
      automation.keywords,
      automation.wholeWordMatch
    );

    if (!matchResult.matched) {
      continue;
    }

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId,
        },
      },
    });

    if (
      existingLog?.status === "SENT" ||
      existingLog?.status === "SKIPPED_PLAN_LIMIT" ||
      existingLog?.status === "SKIPPED_RATE_LIMIT"
    ) {
      continue;
    }

    const usage = await canSendDMForWorkspace(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
        update: {
          status: "SKIPPED_PLAN_LIMIT",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    const rateLimit = await checkRateLimit(instagramAccountId, requeueAttempt);
    if (!rateLimit.allowed) {
      if (rateLimit.shouldSkip) {
        await prisma.dmLog.upsert({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          create: {
            workspaceId: automation.workspaceId,
            automationId: automation.id,
            instagramAccountId: automation.instagramAccountId,
            commenterId,
            commenterName,
            commentText,
            commentId,
            matchedKeyword: matchResult.matchedKeyword,
            status: "SKIPPED_RATE_LIMIT",
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
          update: {
            status: "SKIPPED_RATE_LIMIT",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await prisma.dmLog.upsert({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          create: {
            workspaceId: automation.workspaceId,
            automationId: automation.id,
            instagramAccountId: automation.instagramAccountId,
            commenterId,
            commenterName,
            commentText,
            commentId,
            matchedKeyword: matchResult.matchedKeyword,
            status: "PENDING",
            errorMessage: "Hourly rate limit hit; retry scheduled",
          },
          update: {
            status: "PENDING",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly rate limit hit; retry scheduled",
          },
        });

        await getDMQueue().add(
          "process-comment",
          {
            ...job.data,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `comment:${instagramAccountId}:${commentId}:retry:${requeueAttempt + 1}`,
          }
        );
        continue;
      }
    }

    if (!automation.instagramAccount.accessToken) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
        update: {
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
      });
      continue;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
        update: {
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
      });
      continue;
    }

    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId,
        },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId,
        commenterName,
        commentText,
        commentId,
        matchedKeyword: matchResult.matchedKeyword,
        status: "PENDING",
        attempts: job.attemptsMade + 1,
        errorMessage: null,
      },
      update: {
        status: "PENDING",
        attempts: job.attemptsMade + 1,
        matchedKeyword: matchResult.matchedKeyword,
        errorMessage: null,
      },
    });

    const dmMessage = automation.dmMessage.replace(
      /\{username\}/gi,
      commenterName ?? "there"
    );

    try {
      await sendPrivateReply(
        accessToken,
        automation.instagramAccount.instagramId,
        commentId,
        dmMessage
      );

      await incrementDMCounter(instagramAccountId);
      await incrementWorkspaceDMUsage(automation.workspaceId);

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SENT",
          dmSentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }
  }
}

export function createDMWorker(): Worker<ProcessCommentJob> {
  const worker = new Worker<ProcessCommentJob>(
    "dm-processing",
    processComment,
    {
      connection: getRedisConnection(),
      concurrency: 5,
      settings: {
        backoffStrategy: (attemptsMade: number) =>
          BACKOFF_DELAYS[Math.min(attemptsMade - 1, BACKOFF_DELAYS.length - 1)],
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[DM Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[DM Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message
    );
  });

  worker.on("error", (err) => {
    console.error("[DM Worker] Worker error:", err.message);
  });

  return worker;
}
