import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getEffectivePlan, PLAN_LIMITS } from "@/lib/billing/plans";
import { calculateCtr, normalizeTopKeywords } from "@/lib/tracking/analytics";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";
import { buildReportUrl, generateReportShareSlug } from "@/lib/reports/share";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

const createAutomationSchema = z.object({
  name: z.string().min(1).max(100),
  goal: z.string().min(1).max(120).optional().nullable(),
  instagramAccountId: z.string().min(1).optional().nullable(),
  postId: z.string().min(1),
  postUrl: z.string().url().optional().nullable(),
  keywords: z.array(z.string().min(1).max(50)).min(1).max(10),
  dmMessage: z.string().min(1).max(1000),
  trackedDestinationUrl: z.string().url().optional().nullable(),
  isActive: z.boolean().optional().default(true),
  wholeWordMatch: z.boolean().optional().default(true),
  // Public comment reply pool
  commentReplyEnabled: z.boolean().optional().default(false),
  commentReplies: z.array(z.string().min(1).max(300)).max(10).optional().default([]),
  // Welcome message / rich reply
  welcomeEnabled: z.boolean().optional().default(false),
  welcomeMessage: z.string().max(500).optional().nullable(),
  welcomeImageUrl: z.string().url().optional().nullable(),
  welcomeButtonText: z.string().max(20).optional().nullable(),
  // Follow-check gate
  followCheckEnabled: z.boolean().optional().default(false),
  followCheckMessage: z.string().max(500).optional().nullable(),
  followCheckButtonText: z.string().max(20).optional().nullable(),
  // Rich DM message type
  dmMessageType: z.enum(["TEXT", "CARD", "CAROUSEL"] as const).optional().default("TEXT"),
  dmMessagePayload: z.record(z.string(), z.unknown()).optional().nullable(),
});

const updateAutomationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  goal: z.string().min(1).max(120).optional().nullable(),
  postId: z.string().min(1).optional(),
  postUrl: z.string().url().optional().nullable(),
  keywords: z.array(z.string().min(1).max(50)).min(1).max(10).optional(),
  dmMessage: z.string().min(1).max(1000).optional(),
  isActive: z.boolean().optional(),
  wholeWordMatch: z.boolean().optional(),
  reportShareEnabled: z.boolean().optional(),
  // Public comment reply pool
  commentReplyEnabled: z.boolean().optional(),
  commentReplies: z.array(z.string().min(1).max(300)).max(10).optional(),
  // Welcome message / rich reply
  welcomeEnabled: z.boolean().optional(),
  welcomeMessage: z.string().max(500).optional().nullable(),
  welcomeImageUrl: z.string().url().optional().nullable(),
  welcomeButtonText: z.string().max(20).optional().nullable(),
  // Follow-check gate
  followCheckEnabled: z.boolean().optional(),
  followCheckMessage: z.string().max(500).optional().nullable(),
  followCheckButtonText: z.string().max(20).optional().nullable(),
  // Rich DM message type
  dmMessageType: z.enum(["TEXT", "CARD", "CAROUSEL"] as const).optional(),
  dmMessagePayload: z.record(z.string(), z.unknown()).optional().nullable(),
});

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  const instagramAccountId =
    request.nextUrl.searchParams.get("instagramAccountId");
  const accountFilter =
    instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {};

  const automations = await prisma.automation.findMany({
    where: { workspaceId, ...accountFilter },
    include: {
      instagramAccount: {
        select: { username: true, instagramId: true },
      },
      _count: {
        select: { dmLogs: true },
      },
      trackedLinks: {
        select: {
          id: true,
          slug: true,
          label: true,
          destinationUrl: true,
          _count: { select: { clicks: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const automationsWithReports = await Promise.all(
    automations.map(async (automation) => {
      if (automation.reportShareSlug) return automation;

      const updated = await prisma.automation.update({
        where: { id: automation.id },
        data: { reportShareSlug: generateReportShareSlug() },
        select: { reportShareSlug: true },
      });

      return {
        ...automation,
        reportShareSlug: updated.reportShareSlug,
      };
    })
  );

  const [statusCounts, clickCounts, keywordCounts] = await Promise.all([
    prisma.dmLog.groupBy({
      by: ["automationId", "status"],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["automationId"],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["automationId", "matchedKeyword"],
      where: { workspaceId, matchedKeyword: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const analytics = new Map<
    string,
    {
      sent: number;
      skipped: number;
      failed: number;
      clicks: number;
      topKeywords: { keyword: string; count: number }[];
    }
  >();

  for (const automation of automationsWithReports) {
    analytics.set(automation.id, {
      sent: 0,
      skipped: 0,
      failed: 0,
      clicks: 0,
      topKeywords: [],
    });
  }

  for (const row of statusCounts) {
    const item = analytics.get(row.automationId);
    if (!item) continue;
    const count = row._count._all;
    if (row.status === "SENT") item.sent += count;
    if (row.status === "FAILED") item.failed += count;
    if (row.status.startsWith("SKIPPED_")) item.skipped += count;
  }

  for (const row of clickCounts) {
    const item = analytics.get(row.automationId);
    if (item) item.clicks = row._count._all;
  }

  for (const automation of automationsWithReports) {
    const item = analytics.get(automation.id);
    if (!item) continue;
    item.topKeywords = normalizeTopKeywords(
      keywordCounts
        .filter((row) => row.automationId === automation.id)
        .map((row) => ({
          matchedKeyword: row.matchedKeyword,
          _count: row._count._all,
        })),
      3
    );
  }

  return NextResponse.json({
    success: true,
    data: automationsWithReports.map((automation) => {
      const item = analytics.get(automation.id) ?? {
        sent: 0,
        skipped: 0,
        failed: 0,
        clicks: 0,
        topKeywords: [],
      };

      return {
        ...automation,
        trackedLinks: automation.trackedLinks.map((link) => ({
          ...link,
          trackedUrl: buildTrackedUrl(link.slug),
        })),
        reportUrl: automation.reportShareSlug
          ? buildReportUrl(automation.reportShareSlug)
          : null,
        analytics: {
          ...item,
          ctr: calculateCtr(item.clicks, item.sent),
        },
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can create campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const body = await request.json();
  const parsed = createAutomationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const requestedInstagramAccountId =
    parsed.data.instagramAccountId && parsed.data.instagramAccountId !== "all"
      ? parsed.data.instagramAccountId
      : null;

  const [workspace, instagramAccount, automationCount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true, subscriptionStatus: true },
    }),
    requestedInstagramAccountId
      ? prisma.instagramAccount.findFirst({
          where: { id: requestedInstagramAccountId, workspaceId },
        })
      : prisma.instagramAccount.findFirst({
          where: { workspaceId },
          orderBy: { connectedAt: "desc" },
        }),
    prisma.automation.count({ where: { workspaceId } }),
  ]);

  if (!workspace) {
    return NextResponse.json(
      { success: false, error: "Workspace not found" },
      { status: 404 }
    );
  }

  if (!instagramAccount) {
    return NextResponse.json(
      { success: false, error: "Connect Instagram before creating campaigns" },
      { status: 400 }
    );
  }

  const effectivePlan = getEffectivePlan(
    workspace.plan,
    workspace.subscriptionStatus
  );
  const limit = PLAN_LIMITS[effectivePlan];

  if (automationCount >= limit.maxAutomations) {
    return NextResponse.json(
      {
        success: false,
        error: `Plan limit reached. Your ${effectivePlan} plan allows up to ${limit.maxAutomations} campaign(s).`,
      },
      { status: 403 }
    );
  }

  const { trackedDestinationUrl } = parsed.data;

  const automation = await prisma.automation.create({
    data: {
      name: parsed.data.name,
      goal: parsed.data.goal,
      postId: parsed.data.postId,
      postUrl: parsed.data.postUrl,
      keywords: parsed.data.keywords,
      dmMessage: parsed.data.dmMessage,
      isActive: parsed.data.isActive,
      wholeWordMatch: parsed.data.wholeWordMatch,
      commentReplyEnabled: parsed.data.commentReplyEnabled,
      commentReplies: parsed.data.commentReplies,
      welcomeEnabled: parsed.data.welcomeEnabled,
      welcomeMessage: parsed.data.welcomeMessage,
      welcomeImageUrl: parsed.data.welcomeImageUrl,
      welcomeButtonText: parsed.data.welcomeButtonText,
      followCheckEnabled: parsed.data.followCheckEnabled,
      followCheckMessage: parsed.data.followCheckMessage,
      followCheckButtonText: parsed.data.followCheckButtonText,
      dmMessageType: parsed.data.dmMessageType as "TEXT" | "CARD" | "CAROUSEL",
      dmMessagePayload: parsed.data.dmMessagePayload as Prisma.InputJsonValue ?? Prisma.JsonNull,
      workspaceId,
      instagramAccountId: instagramAccount.id,
      reportShareSlug: generateReportShareSlug(),
      ...(trackedDestinationUrl
        ? {
            trackedLinks: {
              create: {
                workspaceId,
                slug: generateTrackedLinkSlug(),
                label: "Primary campaign link",
                destinationUrl: trackedDestinationUrl,
              },
            },
          }
        : {}),
    },
    include: {
      trackedLinks: true,
    },
  });

  return NextResponse.json(
    { success: true, data: automation },
    { status: 201 }
  );
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can update campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json(
      { success: false, error: "Missing campaign ID" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = updateAutomationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const existing = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
  });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  const { dmMessagePayload, dmMessageType, ...rest } = parsed.data;
  const updated = await prisma.automation.update({
    where: { id: automationId },
    data: {
      ...rest,
      ...(dmMessageType !== undefined ? { dmMessageType: dmMessageType as "TEXT" | "CARD" | "CAROUSEL" } : {}),
      ...(dmMessagePayload !== undefined
        ? { dmMessagePayload: dmMessagePayload === null ? Prisma.JsonNull : (dmMessagePayload as Prisma.InputJsonValue) }
        : {}),
    },
  });

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can delete campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json(
      { success: false, error: "Missing campaign ID" },
      { status: 400 }
    );
  }

  const existing = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
  });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  await prisma.automation.delete({ where: { id: automationId } });

  return NextResponse.json({ success: true, data: { deleted: true } });
}
