import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getBaseUrl } from "@/lib/env";
import { prisma } from "@/lib/db/client";
import { getStripe } from "@/lib/stripe";

export async function POST() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { stripeCustomerId: true },
  });

  if (!workspace?.stripeCustomerId) {
    return NextResponse.json(
      { success: false, error: "No Stripe customer exists yet" },
      { status: 400 }
    );
  }

  const portal = await getStripe().billingPortal.sessions.create({
    customer: workspace.stripeCustomerId,
    return_url: `${getBaseUrl()}/settings`,
  });

  return NextResponse.json({ success: true, url: portal.url });
}
