import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";

function instagramGraphBase() {
  return `https://graph.instagram.com/${getMetaGraphApiVersion()}`;
}

function facebookGraphBase() {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

export class MetaApiError extends Error {
  constructor(
    public code: number,
    public subcode: number | undefined,
    public fbTraceId: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class TokenExpiredError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(190, undefined, fbTraceId, message);
    this.name = "TokenExpiredError";
  }
}

export class RateLimitError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(368, undefined, fbTraceId, message);
    this.name = "RateLimitError";
  }
}

export class PermissionError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(100, undefined, fbTraceId, message);
    this.name = "PermissionError";
  }
}

interface GraphApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface InstagramUser {
  id: string;
  ig_id?: string;
  username: string;
  name?: string;
}

export interface InstagramComment {
  id: string;
  text: string;
  from: {
    id: string;
    username: string;
  };
  timestamp: string;
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink?: string;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || (data as GraphApiError).error) {
    const err = (data as GraphApiError).error;
    const code = err?.code ?? response.status;
    const subcode = err?.error_subcode;
    const traceId = err?.fbtrace_id;
    const message = err?.message ?? "Unknown Meta API error";

    switch (code) {
      case 190:
        throw new TokenExpiredError(message, traceId);
      case 368:
      case 4:
      case 17:
        throw new RateLimitError(message, traceId);
      case 10:
      case 100:
      case 200:
        throw new PermissionError(message, traceId);
      default:
        throw new MetaApiError(code, subcode, traceId, message);
    }
  }

  return data as T;
}

export async function sendPrivateReply(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  message: string
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
      }),
    }
  );

  return handleResponse(response);
}

export interface RichReplyButton {
  type: "postback" | "web_url";
  title: string;
  payload?: string;
  url?: string;
}

export interface GenericTemplateElement {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: RichReplyButton[];
}

export async function sendRichReply(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  options: {
    title: string;
    subtitle?: string;
    imageUrl?: string;
    buttons?: RichReplyButton[];
  }
): Promise<{ recipient_id: string; message_id: string }> {
  return sendGenericTemplate(accessToken, instagramAccountId, commentId, [
    options,
  ]);
}

export async function sendGenericTemplate(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  elements: GenericTemplateElement[]
): Promise<{ recipient_id: string; message_id: string }> {
  const mappedElements = elements.map((el) => {
    const mapped: Record<string, unknown> = { title: el.title };
    if (el.subtitle) mapped.subtitle = el.subtitle;
    if (el.imageUrl) mapped.image_url = el.imageUrl;
    if (el.buttons?.length) mapped.buttons = el.buttons;
    return mapped;
  });

  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "generic",
              elements: mappedElements,
            },
          },
        },
      }),
    }
  );

  return handleResponse(response);
}

export async function replyToComment(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${commentId}/replies`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    }
  );

  return handleResponse(response);
}

export async function sendDirectRichMessage(
  accessToken: string,
  instagramAccountId: string,
  recipientIgsid: string,
  elements: GenericTemplateElement[]
): Promise<{ recipient_id: string; message_id: string }> {
  const mappedElements = elements.map((el) => {
    const mapped: Record<string, unknown> = { title: el.title };
    if (el.subtitle) mapped.subtitle = el.subtitle;
    if (el.imageUrl) mapped.image_url = el.imageUrl;
    if (el.buttons?.length) mapped.buttons = el.buttons;
    return mapped;
  });

  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientIgsid },
        messaging_type: "RESPONSE",
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "generic",
              elements: mappedElements,
            },
          },
        },
      }),
    }
  );

  return handleResponse(response);
}

export async function sendDirectMessage(
  accessToken: string,
  instagramAccountId: string,
  recipientIgsid: string,
  message: string
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientIgsid },
        messaging_type: "RESPONSE",
        message: { text: message },
      }),
    }
  );

  return handleResponse(response);
}

export async function getMediaComments(
  accessToken: string,
  mediaId: string
): Promise<InstagramComment[]> {
  const url = new URL(`${instagramGraphBase()}/${mediaId}/comments`);
  url.searchParams.set("fields", "id,text,from,timestamp");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramComment[] }>(response);
  return data.data;
}

export async function getUserInfo(accessToken: string): Promise<InstagramUser> {
  const url = new URL(`${instagramGraphBase()}/me`);
  url.searchParams.set("fields", "id,ig_id,username,name");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  return handleResponse<InstagramUser>(response);
}

export async function getMediaById(
  accessToken: string,
  mediaId: string
): Promise<InstagramMedia> {
  const url = new URL(`${instagramGraphBase()}/${mediaId}`);
  url.searchParams.set(
    "fields",
    "id,caption,media_type,media_url,thumbnail_url,timestamp,permalink"
  );
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  return handleResponse<InstagramMedia>(response);
}

export async function getUserMedia(
  accessToken: string,
  limit = 25,
  after?: string
): Promise<{ posts: InstagramMedia[]; nextCursor?: string }> {
  const url = new URL(`${instagramGraphBase()}/me/media`);
  url.searchParams.set(
    "fields",
    "id,caption,media_type,media_url,thumbnail_url,timestamp,permalink"
  );
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("access_token", accessToken);
  if (after) url.searchParams.set("after", after);

  const response = await fetch(url.toString());
  const data = await handleResponse<{
    data: InstagramMedia[];
    paging?: { cursors?: { after?: string }; next?: string };
  }>(response);
  return {
    posts: data.data,
    nextCursor: data.paging?.next ? data.paging.cursors?.after : undefined,
  };
}

export async function getLongLivedToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(`${instagramGraphBase()}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", requireEnv("INSTAGRAM_APP_SECRET"));
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<TokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

export async function refreshLongLivedToken(
  longLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(`${instagramGraphBase()}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", longLivedToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<TokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

export async function subscribeInstagramAccountToWebhooks(
  instagramAccountId: string,
  accessToken: string
): Promise<{ success: boolean }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        subscribed_fields: ["comments", "messages"],
      }),
    }
  );

  return handleResponse(response);
}

export async function debugToken(inputToken: string, accessToken: string) {
  const url = new URL(`${facebookGraphBase()}/debug_token`);
  url.searchParams.set("input_token", inputToken);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  return handleResponse(response);
}
