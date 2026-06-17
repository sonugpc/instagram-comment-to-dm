import { createHmac, timingSafeEqual } from "crypto";

export function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!signature) return false;

  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appSecret) {
    throw new Error("FACEBOOK_APP_SECRET environment variable is required");
  }

  const expectedSignature =
    "sha256=" + createHmac("sha256", appSecret).update(payload).digest("hex");

  console.log("[Webhook] received sig :", signature);
  console.log("[Webhook] expected sig :", expectedSignature);
  console.log("[Webhook] body length  :", payload.length);

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

export interface WebhookCommentEvent {
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
}

interface WebhookEntry {
  id: string;
  time: number;
  changes?: Array<{
    field: string;
    value: {
      id?: string;
      comment_id?: string;
      text?: string;
      from?: {
        id?: string;
        username?: string;
      };
      media?: {
        id?: string;
      };
      media_id?: string;
    };
  }>;
  messaging?: Array<{
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number;
    postback?: {
      title?: string;
      payload?: string;
    };
  }>;
}

interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export interface WebhookPostbackEvent {
  instagramAccountId: string;
  senderIgsid: string;
  postbackPayload: string;
  postbackTitle: string;
}

export function parsePostbackEvents(
  payload: WebhookPayload
): WebhookPostbackEvent[] {
  const events: WebhookPostbackEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const msg of entry.messaging ?? []) {
      if (!msg.postback?.payload) continue;
      const senderIgsid = msg.sender?.id;
      if (!entry.id || !senderIgsid) continue;

      events.push({
        instagramAccountId: entry.id,
        senderIgsid,
        postbackPayload: msg.postback.payload,
        postbackTitle: msg.postback.title ?? "",
      });
    }
  }

  return events;
}

export function parseCommentEvents(payload: WebhookPayload): WebhookCommentEvent[] {
  const events: WebhookCommentEvent[] = [];

  if (payload.object !== "instagram") {
    return events;
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;

      const value = change.value;
      const commentId = value?.id ?? value?.comment_id;
      const mediaId = value?.media?.id ?? value?.media_id;
      const commenterId = value?.from?.id;

      if (!entry.id || !commentId || !mediaId || !commenterId) {
        continue;
      }

      events.push({
        instagramAccountId: entry.id,
        commentId,
        commentText: value.text ?? "",
        commenterId,
        commenterName: value.from?.username,
        mediaId,
      });
    }
  }

  return events;
}
