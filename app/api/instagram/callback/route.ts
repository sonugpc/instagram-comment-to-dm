import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { getLongLivedToken, getUserInfo, subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";
import {
  encryptToken,
  exchangeCodeForToken,
  verifyOAuthState,
} from "@/lib/meta/oauth";
import { canManageWorkspace } from "@/lib/workspace-access";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: state.workspaceId,
      userId: session.user.id,
    },
    include: {
      workspace: {
        select: {
          plan: true,
          subscriptionStatus: true,
        },
      },
    },
  });

  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=forbidden`);
  }

  try {
    const redirectUri = `${baseUrl}/api/instagram/callback`;
    const { accessToken: shortLivedToken } = await exchangeCodeForToken(
      code,
      redirectUri
    );
    const { accessToken: longLivedToken, expiresIn } =
      await getLongLivedToken(shortLivedToken);
    const userInfo = await getUserInfo(longLivedToken);
    // ig_id is the classic Instagram Business Account ID used by webhooks (entry.id).
    // id is the app-scoped user ID returned by the new Business Login API — it differs.
    // ig_id is the classic Instagram Business Account ID used by webhooks (entry.id).
    // id is the app-scoped user ID returned by the new Business Login API — it differs.
    const instagramId = userInfo.ig_id ?? userInfo.id;
    const connection = await canConnectInstagramAccount({
      workspaceId: state.workspaceId,
      plan: membership.workspace.plan,
      subscriptionStatus: membership.workspace.subscriptionStatus,
      instagramId,
      legacyInstagramId: userInfo.id,
    });

    if (!connection.allowed) {
      const reason =
        connection.reason === "already_connected"
          ? "already_connected"
          : "account_limit";
      return NextResponse.redirect(`${baseUrl}/settings?instagram=${reason}`);
    }

    const encryptedToken = encryptToken(longLivedToken);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    let webhookSubscribed = false;
    try {
      const subscription = await subscribeInstagramAccountToWebhooks(
        userInfo.id,
        longLivedToken
      );
      webhookSubscribed = Boolean(subscription.success);
    } catch (subscriptionError) {
      console.warn(
        "[Instagram Callback] Webhook subscription failed:",
        subscriptionError
      );
    }

    // Search by both the new ig_id and the old app-scoped id so a reconnect
    // updates the existing row (including migrating instagramId) instead of
    // creating a duplicate row that orphans all FK-linked automations.
    const searchIds = [instagramId];
    if (userInfo.id !== instagramId) searchIds.push(userInfo.id);
    const existingAccount = await prisma.instagramAccount.findFirst({
      where: { instagramId: { in: searchIds } },
      select: { id: true },
    });

    const accountData = {
      workspaceId: state.workspaceId,
      instagramId,
      username: userInfo.username,
      name: userInfo.name,
      accessToken: encryptedToken,
      tokenExpiresAt,
      webhookSubscribed,
    };

    if (existingAccount) {
      await prisma.instagramAccount.update({
        where: { id: existingAccount.id },
        data: accountData,
      });
    } else {
      await prisma.instagramAccount.create({ data: accountData });
    }

    return NextResponse.redirect(`${baseUrl}/dashboard?connected=true`);
  } catch (err) {
    console.error("[Instagram Callback] Error:", err);
    return NextResponse.redirect(`${baseUrl}/settings?instagram=failed`);
  }
}
