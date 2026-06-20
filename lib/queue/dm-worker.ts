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
  sendDirectRichMessage,
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

type CardPayload = {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: Array<{ type: "web_url"; title: string; url: string }>;
};

function buildTemplateElements(
  cards: CardPayload[],
  commenterName: string | undefined,
  trackedLinks: Array<{ slug: string; destinationUrl: string }>
): GenericTemplateElement[] {
  return cards.map((card) => ({
    title: renderMessageWithTracking({ message: card.title, commenterName, trackedLinks }),
    subtitle: card.subtitle
      ? renderMessageWithTracking({ message: card.subtitle, commenterName, trackedLinks })
      : undefined,
    imageUrl: card.imageUrl,
    buttons: card.buttons,
  }));
}

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

  console.log(`[Worker] processComment start — jobId: ${job.id} | igAccountId: ${instagramAccountId} | mediaId: ${mediaId} | commentId: ${commentId} | text: "${commentText}" | from: ${commenterId} (${commenterName})`);

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

  console.log(`[Worker] Found ${automations.length} active automation(s) for mediaId: ${mediaId}`);
  if (automations.length === 0) {
    console.log(`[Worker] No automations matched — check postId matches mediaId, and campaign is active`);
  }

  for (const automation of automations) {
    console.log(`[Worker] Checking automation: "${automation.name}" (${automation.id}) | keywords: [${automation.keywords.join(", ")}] | wholeWord: ${automation.wholeWordMatch}`);

    const matchResult = matchKeywords(
      commentText,
      automation.keywords,
      automation.wholeWordMatch
    );

    if (!matchResult.matched) {
      console.log(`[Worker] Keyword NOT matched for automation "${automation.name}" — comment: "${commentText}"`);
      continue;
    }
    console.log(`[Worker] Keyword MATCHED: "${matchResult.matchedKeyword}" in automation "${automation.name}"`);

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
      console.log(`[Worker] Skipping — already processed with status: ${existingLog.status}`);
      continue;
    }

    if (!automation.instagramAccount.accessToken) {
      console.log(`[Worker] No access token for Instagram account ${instagramAccountId}`);
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
      console.log(`[Worker] Access token decrypted OK`);
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
    console.log(`[Worker] Plan usage check — allowed: ${usage.allowed} | limit: ${usage.limit}`);
    if (!usage.allowed) {
      console.log(`[Worker] SKIPPED — monthly DM limit reached (${usage.limit})`);
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
      console.log(`[Worker] Rate limit check — allowed: ${rateLimit.allowed}`);
    } catch (error) {
      console.error(`[Worker] Rate limiter threw:`, formatError(error));
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
        console.log(`[Worker] SKIPPED — hourly rate limit reached`);
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
        console.log(`[Worker] Requeueing — rate limit hit, delay: ${rateLimit.requeueDelayMs}ms`);
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
      console.log(`[Worker] Sending public comment reply: "${rendered}"`);
      try {
        await replyToComment(accessToken, commentId, rendered);
        console.log(`[Worker] Public comment reply sent OK`);
      } catch (err) {
        console.error(`[Worker] Public comment reply failed (non-fatal):`, formatError(err));
      }
    } else {
      console.log(`[Worker] commentReplyEnabled: ${automation.commentReplyEnabled} | replies count: ${automation.commentReplies.length} — skipping public reply`);
    }

    // Follow-check gate: send rich card with "I'm Following" button
    if (automation.followCheckEnabled) {
      const followMsg =
        automation.followCheckMessage ??
        `Hey ${commenterName ?? "there"}! To receive this content, please follow our account first 💙`;

      console.log(`[Worker] Follow gate enabled — sending rich card with button`);
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
        console.log(`[Worker] Follow gate card sent OK — waiting for postback`);
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { status: "WELCOME_SENT", dmSentAt: new Date(), errorMessage: null },
        });
      } catch (error) {
        console.error(`[Worker] Follow gate sendRichReply failed:`, formatError(error));
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
      console.log(`[Worker] Welcome flow enabled — sending rich card with "Send me Link" button`);
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
        console.log(`[Worker] Welcome card sent OK — waiting for postback`);
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { status: "WELCOME_SENT", dmSentAt: new Date(), errorMessage: null },
        });
      } catch (error) {
        console.error(`[Worker] Welcome sendRichReply failed:`, formatError(error));
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
    console.log(`[Worker] Sending content DM — type: ${automation.dmMessageType}`);
    try {
      if (automation.dmMessageType === "CARD" && automation.dmMessagePayload) {
        const elements = buildTemplateElements(
          [automation.dmMessagePayload as CardPayload],
          commenterName,
          automation.trackedLinks
        );
        if (elements.length === 0) throw new Error("CARD payload produced no elements");
        console.log(`[Worker] Sending CARD to commentId: ${commentId}`);
        await sendGenericTemplate(accessToken, automation.instagramAccount.instagramId, commentId, elements);
      } else if (automation.dmMessageType === "CAROUSEL" && automation.dmMessagePayload) {
        const payload = automation.dmMessagePayload as { cards: CardPayload[] };
        const elements = buildTemplateElements(payload.cards, commenterName, automation.trackedLinks);
        if (elements.length === 0) throw new Error("CAROUSEL has 0 cards");
        console.log(`[Worker] Sending CAROUSEL (${elements.length} cards) to commentId: ${commentId}`);
        await sendGenericTemplate(accessToken, automation.instagramAccount.instagramId, commentId, elements);
      } else {
        if (automation.dmMessageType !== "TEXT") {
          console.warn(`[Worker] dmMessageType "${automation.dmMessageType}" has no payload — sending text DM fallback`);
        }
        const dmMessage = renderMessageWithTracking({
          message: automation.dmMessage,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        console.log(`[Worker] Sending TEXT private reply to commentId: ${commentId} | message: "${dmMessage}"`);
        await sendPrivateReply(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          dmMessage
        );
      }

      console.log(`[Worker] DM sent OK — updating log to SENT`);
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
      console.error(`[Worker] DM send FAILED:`, formatError(error));
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
  console.log(`[Worker] processComment done — jobId: ${job.id}`);
}

async function processPostback(job: Job<ProcessPostbackJob>): Promise<void> {
  const { automationId, senderIgsid } = job.data;
  console.log(`[Worker] processPostback start — jobId: ${job.id} | automationId: ${automationId} | senderIgsid: ${senderIgsid}`);

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

  if (!automation || !automation.isActive) {
    console.log(`[Worker] Postback aborted — automation not found or inactive: ${automationId}`);
    return;
  }
  console.log(`[Worker] Automation found: "${automation.name}"`);

  if (!automation.instagramAccount.accessToken) {
    console.log(`[Worker] Postback aborted — no access token`);
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
    console.log(`[Worker] Access token decrypted OK`);
  } catch {
    console.error(`[Worker] Postback aborted — failed to decrypt access token`);
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
  console.log(`[Worker] Pending WELCOME_SENT log: ${pendingLog ? `found (id: ${pendingLog.id})` : "NOT FOUND"}`);

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  console.log(`[Worker] Postback plan usage — allowed: ${usage.allowed}`);
  if (!usage.allowed) {
    console.log(`[Worker] Postback aborted — plan limit reached`);
    return;
  }

  const commenterName = pendingLog?.commenterName ?? undefined;
  const igAccountId = automation.instagramAccount.instagramId;

  console.log(`[Worker] Sending postback DM — type: ${automation.dmMessageType} | to: ${senderIgsid}`);

  try {
    if (automation.dmMessageType === "CARD" && automation.dmMessagePayload) {
      const elements = buildTemplateElements(
        [automation.dmMessagePayload as CardPayload],
        commenterName,
        automation.trackedLinks
      );
      if (elements.length === 0) throw new Error("CARD payload produced no elements");
      await sendDirectRichMessage(accessToken, igAccountId, senderIgsid, elements);
    } else if (automation.dmMessageType === "CAROUSEL" && automation.dmMessagePayload) {
      const payload = automation.dmMessagePayload as { cards: CardPayload[] };
      const elements = buildTemplateElements(payload.cards, commenterName, automation.trackedLinks);
      if (elements.length === 0) throw new Error("CAROUSEL has 0 cards");
      await sendDirectRichMessage(accessToken, igAccountId, senderIgsid, elements);
    } else {
      if (automation.dmMessageType !== "TEXT") {
        console.warn(`[Worker] dmMessageType "${automation.dmMessageType}" has no payload — sending text DM fallback`);
      }
      const dmMessage = renderMessageWithTracking({
        message: automation.dmMessage,
        commenterName,
        trackedLinks: automation.trackedLinks,
      });
      console.log(`[Worker] Postback TEXT DM: "${dmMessage}"`);
      await sendDirectMessage(accessToken, igAccountId, senderIgsid, dmMessage);
    }

    console.log(`[Worker] Postback DM sent OK`);

    if (pendingLog) {
      await prisma.dmLog.update({
        where: { id: pendingLog.id },
        data: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
      });
      console.log(`[Worker] DM log updated to SENT`);
    }
  } catch (error) {
    console.error(`[Worker] Postback DM send FAILED:`, formatError(error));
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
    console.error("[DM Worker] Worker error:", err.message || err.toString(), err);
    void prisma.operationalEvent
      .create({
        data: {
          source: "WORKER",
          level: "ERROR",
          message: `DM worker process error: ${err.message || err.toString()}`,
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
