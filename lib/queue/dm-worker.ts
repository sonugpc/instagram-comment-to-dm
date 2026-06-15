import { Worker, type Job } from "bullmq";
import {
  getDMQueue,
  getRedisConnection,
  type ProcessCommentJob,
  type ProcessPostbackJob,
} from "./client";
import { prisma } from "@/lib/db/client";
import {
  MetaApiError,
  sendPrivateReply,
  sendRichReply,
  sendGenericTemplate,
  sendDirectMessage,
  replyToComment,
  type GenericTemplateElement,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { reserveDMSlot } from "@/lib/utils/rate-limiter";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import { recordWorkerAlert } from "@/lib/ops/worker-health";
import { renderMessageWithTracking } from "@/lib/tracking/message";

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
      trackedLinks: {
        select: {
          slug: true,
          destinationUrl: true,
        },
        orderBy: { createdAt: "asc" },
      },
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

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SKIPPED_PLAN_LIMIT",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    let rateLimit;
    try {
      rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
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

    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      if (rateLimit.shouldSkip) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "SKIPPED_RATE_LIMIT",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
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

    // Public comment reply (randomly picked from pool)
    if (automation.commentReplyEnabled && automation.commentReplies.length > 0) {
      const pick = automation.commentReplies[
        Math.floor(Math.random() * automation.commentReplies.length)
      ];
      const rendered = pick.replace(/\{username\}/gi, commenterName ?? "there");
      try {
        await replyToComment(accessToken, commentId, rendered);
      } catch {
        // Non-fatal — log but continue with the DM flow
      }
    }

    // Follow-check gate: send rich card with "I'm Following" button
    if (automation.followCheckEnabled) {
      const followMsg =
        automation.followCheckMessage ??
        `Hey ${commenterName ?? "there"}! To receive this content, please follow our account first 💙`;

      try {
        await sendRichReply(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          {
            title: followMsg,
            buttons: [
              {
                type: "postback",
                title: automation.followCheckButtonText ?? "I'm Following ✅",
                payload: `FOLLOW_CONFIRM:${automation.id}`,
              },
            ],
          }
        );
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { status: "WELCOME_SENT", dmSentAt: new Date(), errorMessage: null },
        });
      } catch (error) {
        await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { status: "FAILED", attempts: job.attemptsMade + 1, errorMessage: formatError(error) },
        });
        throw error;
      }
      continue;
    }

    // Welcome + Send me Link flow: send rich card with button, record WELCOME_SENT
    if (automation.welcomeEnabled) {
      try {
        await sendRichReply(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          {
            title:
              automation.welcomeMessage ??
              `Hey ${commenterName ?? "there"}! Click the button to get your link.`,
            imageUrl: automation.welcomeImageUrl ?? undefined,
            buttons: [
              {
                type: "postback",
                title: automation.welcomeButtonText ?? "Send me Link",
                payload: `SEND_LINK:${automation.id}`,
              },
            ],
          }
        );
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { status: "WELCOME_SENT", dmSentAt: new Date(), errorMessage: null },
        });
      } catch (error) {
        await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { status: "FAILED", attempts: job.attemptsMade + 1, errorMessage: formatError(error) },
        });
        throw error;
      }
      continue;
    }

    // Send the actual private reply (text, card, or carousel)
    try {
      if (automation.dmMessageType === "CARD" && automation.dmMessagePayload) {
        const card = automation.dmMessagePayload as {
          title: string; subtitle?: string; imageUrl?: string;
          buttons?: Array<{ type: "web_url"; title: string; url: string }>;
        };
        const element: GenericTemplateElement = {
          title: renderMessageWithTracking({ message: card.title, commenterName, trackedLinks: automation.trackedLinks }),
          subtitle: card.subtitle
            ? renderMessageWithTracking({ message: card.subtitle, commenterName, trackedLinks: automation.trackedLinks })
            : undefined,
          imageUrl: card.imageUrl,
          buttons: card.buttons,
        };
        await sendGenericTemplate(accessToken, automation.instagramAccount.instagramId, commentId, [element]);
      } else if (automation.dmMessageType === "CAROUSEL" && automation.dmMessagePayload) {
        const payload = automation.dmMessagePayload as {
          cards: Array<{ title: string; subtitle?: string; imageUrl?: string;
            buttons?: Array<{ type: "web_url"; title: string; url: string }> }>;
        };
        const elements: GenericTemplateElement[] = payload.cards.map((card) => ({
          title: renderMessageWithTracking({ message: card.title, commenterName, trackedLinks: automation.trackedLinks }),
          subtitle: card.subtitle
            ? renderMessageWithTracking({ message: card.subtitle, commenterName, trackedLinks: automation.trackedLinks })
            : undefined,
          imageUrl: card.imageUrl,
          buttons: card.buttons,
        }));
        await sendGenericTemplate(accessToken, automation.instagramAccount.instagramId, commentId, elements);
      } else {
        const dmMessage = renderMessageWithTracking({
          message: automation.dmMessage,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendPrivateReply(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          dmMessage
        );
      }

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
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

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

async function processPostback(job: Job<ProcessPostbackJob>): Promise<void> {
  const { automationId, senderIgsid } = job.data;

  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    include: {
      instagramAccount: true,
      trackedLinks: {
        select: { slug: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!automation || !automation.isActive) return;

  if (!automation.instagramAccount.accessToken) return;

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    return;
  }

  // Find the pending welcome DM log for this sender so we can mark it sent
  const pendingLog = await prisma.dmLog.findFirst({
    where: {
      automationId,
      commenterId: senderIgsid,
      status: "WELCOME_SENT",
    },
    orderBy: { createdAt: "desc" },
  });

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) return;

  const dmMessage = renderMessageWithTracking({
    message: automation.dmMessage,
    commenterName: pendingLog?.commenterName ?? undefined,
    trackedLinks: automation.trackedLinks,
  });

  try {
    await sendDirectMessage(
      accessToken,
      automation.instagramAccount.instagramId,
      senderIgsid,
      dmMessage
    );

    if (pendingLog) {
      await prisma.dmLog.update({
        where: { id: pendingLog.id },
        data: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
      });
    }
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
    if (pendingLog) {
      await prisma.dmLog.update({
        where: { id: pendingLog.id },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
    }
    throw error;
  }
}

async function recordWorkerFailure(
  job: Job<ProcessCommentJob> | undefined,
  error: Error
) {
  try {
    const instagramAccountId = job?.data.instagramAccountId;
    const account = instagramAccountId
      ? await prisma.instagramAccount.findUnique({
          where: { instagramId: instagramAccountId },
          select: { workspaceId: true },
        })
      : null;

    await prisma.operationalEvent.create({
      data: {
        workspaceId: account?.workspaceId ?? null,
        source: "WORKER",
        level: "ERROR",
        message: `DM worker job ${job?.id ?? "unknown"} failed: ${error.message}`,
        payload: {
          jobId: job?.id ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          instagramAccountId: instagramAccountId ?? null,
          commentId: job?.data.commentId ?? null,
        },
      },
    });

    await recordWorkerAlert({
      level: "error",
      message: error.message,
      jobId: job?.id,
      instagramAccountId,
      commentId: job?.data.commentId,
    });
  } catch (recordError) {
    console.error(
      "[DM Worker] Failed to record worker failure:",
      formatError(recordError)
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dispatchJob(job: Job<any>): Promise<void> {
  if (job.name === "process-postback") {
    return processPostback(job as Job<ProcessPostbackJob>);
  }
  return processComment(job as Job<ProcessCommentJob>);
}

export function createDMWorker(): Worker {
  const worker = new Worker(
    "dm-processing",
    dispatchJob,
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
    void recordWorkerFailure(job, err);
  });

  worker.on("error", (err) => {
    console.error("[DM Worker] Worker error:", err.message);
    void prisma.operationalEvent
      .create({
        data: {
          source: "WORKER",
          level: "ERROR",
          message: `DM worker process error: ${err.message}`,
          payload: { name: err.name },
        },
      })
      .catch((recordError) => {
        console.error(
          "[DM Worker] Failed to record worker process error:",
          formatError(recordError)
        );
      });
  });

  return worker;
}
