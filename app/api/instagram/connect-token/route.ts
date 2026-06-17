import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { getUserInfo, subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";
import { encryptToken } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function POST(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_DEV_MODE !== "true") {
    return NextResponse.json({ error: "Dev mode is not enabled" }, { status: 403 });
  }

  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as { token?: string };
  const token = (body.token ?? "").trim();

  if (!token.startsWith("IG") || token.length < 20) {
    return NextResponse.json(
      { error: "Token must start with IG and be a valid Instagram access token" },
      { status: 400 }
    );
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: context.workspaceId, userId: context.userId },
    include: { workspace: { select: { plan: true, subscriptionStatus: true } } },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const userInfo = await getUserInfo(token);
    const instagramId = userInfo.ig_id ?? userInfo.id;

    const connection = await canConnectInstagramAccount({
      workspaceId: context.workspaceId,
      plan: membership.workspace.plan,
      subscriptionStatus: membership.workspace.subscriptionStatus,
      instagramId,
    });

    if (!connection.allowed) {
      const reason =
        connection.reason === "already_connected"
          ? "Account already connected to another workspace"
          : "Account limit reached for your plan";
      return NextResponse.json({ error: reason }, { status: 409 });
    }

    const encryptedToken = encryptToken(token);
    // Long-lived tokens are valid for 60 days
    const tokenExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    let webhookSubscribed = false;
    try {
      const subscription = await subscribeInstagramAccountToWebhooks(instagramId, token);
      webhookSubscribed = Boolean(subscription.success);
    } catch {
      // Webhook subscription will fail locally without a public tunnel URL — that's expected
    }

    await prisma.instagramAccount.upsert({
      where: { instagramId },
      create: {
        workspaceId: context.workspaceId,
        instagramId,
        username: userInfo.username,
        name: userInfo.name,
        accessToken: encryptedToken,
        tokenExpiresAt,
        webhookSubscribed,
      },
      update: {
        workspaceId: context.workspaceId,
        username: userInfo.username,
        name: userInfo.name,
        accessToken: encryptedToken,
        tokenExpiresAt,
        webhookSubscribed,
      },
    });

    return NextResponse.json({ success: true, username: userInfo.username });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
