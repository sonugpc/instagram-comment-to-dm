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
  console.log("[Webhook] POST received");
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  console.log("[Webhook] body length:", rawBody.length, "| has signature:", !!signature);

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.log("[Webhook] Signature verification FAILED");
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }
  console.log("[Webhook] Signature OK");

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
    console.log("[Webhook] Raw payload object:", typeof payload);
  } catch {
    console.log("[Webhook] JSON parse failed");
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
  console.log("[Webhook] Event saved to DB, id:", webhookEvent.id);

  try {
    const webhookPayload = payload as Parameters<typeof parseCommentEvents>[0];
    const commentEvents = parseCommentEvents(webhookPayload);
    const postbackEvents = parsePostbackEvents(webhookPayload);
    console.log("[Webhook] Parsed comment events:", commentEvents.length, "| postback events:", postbackEvents.length);

    const queue = getDMQueue();

    for (const event of commentEvents) {
      console.log("[Webhook] Comment event — igAccountId:", event.instagramAccountId, "| mediaId:", event.mediaId, "| commentId:", event.commentId, "| text:", event.commentText, "| from:", event.commenterId, event.commenterName);

      const account = await prisma.instagramAccount.findUnique({
        where: { instagramId: event.instagramAccountId },
        select: { workspaceId: true },
      });
      console.log("[Webhook] Instagram account lookup:", account ? `found, workspaceId: ${account.workspaceId}` : "NOT FOUND in DB");

      const jobId = `comment:${event.instagramAccountId}:${event.commentId}`;
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
        { jobId }
      );
      console.log("[Webhook] Job enqueued:", jobId);

      if (account) {
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { workspaceId: account.workspaceId },
        });
      }
    }

    for (const event of postbackEvents) {
      console.log("[Webhook] Postback event — payload:", event.postbackPayload, "| sender:", event.senderIgsid);
      const isSendLink = event.postbackPayload.startsWith("SEND_LINK:");
      const isFollowConfirm = event.postbackPayload.startsWith("FOLLOW_CONFIRM:");
      if (!isSendLink && !isFollowConfirm) {
        console.log("[Webhook] Postback skipped — unknown prefix");
        continue;
      }

      const prefix = isSendLink ? "SEND_LINK:" : "FOLLOW_CONFIRM:";
      const rest = event.postbackPayload.slice(prefix.length);
      const colonIdx = rest.indexOf(":");
      const automationId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
      const commentId = colonIdx === -1 ? undefined : rest.slice(colonIdx + 1);
      const jobId = `postback:${event.instagramAccountId}:${event.senderIgsid}:${automationId}:${commentId ?? "x"}`;
      await queue.add(
        "process-postback",
        {
          instagramAccountId: event.instagramAccountId,
          senderIgsid: event.senderIgsid,
          automationId,
          commentId,
        },
        { jobId }
      );
      console.log("[Webhook] Postback job enqueued:", jobId);
    }

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    console.log("[Webhook] Done — event marked PROCESSED");

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Webhook] Processing error:", message, error);
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: "FAILED", errorMessage: message, processedAt: new Date() },
    });

    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
