import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageWorkspace } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getDmTesterIgsid } from "@/lib/env";
import {
  sendDirectMessage,
  sendDirectRichMessage,
  GenericTemplateElement,
} from "@/lib/meta/client";
import type { DmCardPayload, DmCarouselPayload } from "@/lib/types/dm-message";

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const testerIgsid = getDmTesterIgsid();
  if (!testerIgsid) {
    return NextResponse.json(
      { success: false, error: "INSTAGRAM_TESTER_ID is not configured in environment" },
      { status: 400 }
    );
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing id parameter" }, { status: 400 });
  }

  const automation = await prisma.automation.findFirst({
    where: { id, workspaceId: context.workspaceId },
    include: {
      instagramAccount: { select: { instagramId: true, accessToken: true } },
    },
  });

  if (!automation) {
    return NextResponse.json({ success: false, error: "Campaign not found" }, { status: 404 });
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to decrypt Instagram access token" },
      { status: 500 }
    );
  }

  const instagramAccountId = automation.instagramAccount.instagramId;
  const label = `[TEST — ${automation.name}] `;

  try {
    const messageType = automation.dmMessageType;

    if (messageType === "CARD") {
      const payload = automation.dmMessagePayload as DmCardPayload | null;
      if (payload) {
        const element: GenericTemplateElement = {
          title: label + payload.title,
          subtitle: payload.subtitle,
          imageUrl: payload.imageUrl,
          buttons: payload.buttons,
        };
        await sendDirectRichMessage(accessToken, instagramAccountId, testerIgsid, [element]);
      } else {
        await sendDirectMessage(accessToken, instagramAccountId, testerIgsid, label + automation.dmMessage);
      }
    } else if (messageType === "CAROUSEL") {
      const payload = automation.dmMessagePayload as DmCarouselPayload | null;
      if (payload?.cards?.length) {
        const elements: GenericTemplateElement[] = payload.cards.map((card, i) => ({
          title: i === 0 ? label + card.title : card.title,
          subtitle: card.subtitle,
          imageUrl: card.imageUrl,
          buttons: card.buttons,
        }));
        await sendDirectRichMessage(accessToken, instagramAccountId, testerIgsid, elements);
      } else {
        await sendDirectMessage(accessToken, instagramAccountId, testerIgsid, label + automation.dmMessage);
      }
    } else {
      await sendDirectMessage(
        accessToken,
        instagramAccountId,
        testerIgsid,
        label + automation.dmMessage
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
