import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getBaseUrl } from "@/lib/env";
import { createOAuthState, getAuthorizationUrl } from "@/lib/meta/oauth";

export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }

  const redirectUri = `${getBaseUrl()}/api/instagram/callback`;
  const state = createOAuthState(workspaceId);

  return NextResponse.redirect(getAuthorizationUrl(redirectUri, state));
}
