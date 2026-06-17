import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";
import {
  parseCommentEvents,
  parsePostbackEvents,
  verifyWebhookSignature,
} from "@/lib/meta/webhook";
import { Prisma } from "@/app/generated/prisma/client";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json(
    { success: false, error: "Verification failed" },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  console.log("[Webhook] FACEBOOK_APP_SECRET set:", !!process.env.FACEBOOK_APP_SECRET, "| sig header:", signature?.slice(0, 20));

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.log("[Webhook] Signature verification failed");
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      object:
        typeof payload === "object" && payload && "object" in payload
          ? String(payload.object)
          : null,
      payload: payload as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });

  try {
    const webhookPayload = payload as Parameters<typeof parseCommentEvents>[0];
    const commentEvents = parseCommentEvents(webhookPayload);
    const postbackEvents = parsePostbackEvents(webhookPayload);
    const queue = getDMQueue();

    for (const event of commentEvents) {
      const account = await prisma.instagramAccount.findUnique({
        where: { instagramId: event.instagramAccountId },
        select: { workspaceId: true },
      });

      await queue.add(
        "process-comment",
        {
          instagramAccountId: event.instagramAccountId,
          commentId: event.commentId,
          commentText: event.commentText,
          commenterId: event.commenterId,
          commenterName: event.commenterName,
          mediaId: event.mediaId,
        },
        {
          jobId: `comment:${event.instagramAccountId}:${event.commentId}`,
        }
      );

      if (account) {
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { workspaceId: account.workspaceId },
        });
      }
    }

    for (const event of postbackEvents) {
      const isSendLink = event.postbackPayload.startsWith("SEND_LINK:");
      const isFollowConfirm = event.postbackPayload.startsWith("FOLLOW_CONFIRM:");
      if (!isSendLink && !isFollowConfirm) continue;

      const prefix = isSendLink ? "SEND_LINK:" : "FOLLOW_CONFIRM:";
      const automationId = event.postbackPayload.slice(prefix.length);
      await queue.add(
        "process-postback",
        {
          instagramAccountId: event.instagramAccountId,
          senderIgsid: event.senderIgsid,
          automationId,
        },
        {
          jobId: `postback:${event.instagramAccountId}:${event.senderIgsid}:${automationId}`,
        }
      );
    }

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        processedAt: new Date(),
      },
    });

    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
