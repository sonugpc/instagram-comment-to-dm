import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireEnv } from "@/lib/env";
import { prisma } from "@/lib/db/client";
import { getPlanForPriceId } from "@/lib/billing/plans";
import { getStripe } from "@/lib/stripe";
import type { SubscriptionStatus } from "@/app/generated/prisma/client";

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
      return "UNPAID";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    default:
      return "NONE";
  }
}

function getSubscriptionPriceId(subscription: Stripe.Subscription): string | null {
  return subscription.items.data[0]?.price.id ?? null;
}

function getCurrentPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const value = (subscription as unknown as { current_period_end?: number })
    .current_period_end;
  return value ? new Date(value * 1000) : null;
}

async function upsertSubscription(subscription: Stripe.Subscription) {
  const workspaceId = subscription.metadata.workspaceId;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const priceId = getSubscriptionPriceId(subscription);
  const plan = getPlanForPriceId(priceId);
  const subscriptionStatus = mapStripeStatus(subscription.status);

  await prisma.workspace.updateMany({
    where: {
      OR: [
        { id: workspaceId || "__missing_workspace__" },
        { stripeCustomerId: customerId },
        { stripeSubscriptionId: subscription.id },
      ],
    },
    data: {
      plan,
      subscriptionStatus,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodEnd: getCurrentPeriodEnd(subscription),
    },
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const workspaceId = session.metadata?.workspaceId ?? session.client_reference_id;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (!workspaceId || !subscriptionId) return;

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  await upsertSubscription(subscription);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { success: false, error: "Missing Stripe signature" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      requireEnv("STRIPE_WEBHOOK_SECRET")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signature";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  const existing = await prisma.billingEvent.findUnique({
    where: { stripeEventId: event.id },
  });

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertSubscription(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }

  const workspaceId =
    "metadata" in event.data.object
      ? event.data.object.metadata?.workspaceId
      : undefined;

  await prisma.billingEvent.create({
    data: {
      workspaceId: workspaceId || null,
      stripeEventId: event.id,
      type: event.type,
      payload: event as unknown as object,
    },
  });

  return NextResponse.json({ received: true });
}
