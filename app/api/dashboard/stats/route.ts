import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getEffectivePlan, PLAN_LIMITS } from "@/lib/billing/plans";

export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    workspace,
    instagramAccount,
    totalAutomations,
    activeAutomations,
    dmsSentToday,
    dmsSentWeek,
    dmsSentMonth,
    totalDMs,
    recentLogs,
  ] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        name: true,
        plan: true,
        subscriptionStatus: true,
        dmsSentThisPeriod: true,
      },
    }),
    prisma.instagramAccount.findFirst({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: {
        username: true,
        instagramId: true,
        tokenExpiresAt: true,
        webhookSubscribed: true,
      },
    }),
    prisma.automation.count({ where: { workspaceId } }),
    prisma.automation.count({ where: { workspaceId, isActive: true } }),
    prisma.dmLog.count({
      where: { workspaceId, status: "SENT", createdAt: { gte: todayStart } },
    }),
    prisma.dmLog.count({
      where: { workspaceId, status: "SENT", createdAt: { gte: weekStart } },
    }),
    prisma.dmLog.count({
      where: { workspaceId, status: "SENT", createdAt: { gte: monthStart } },
    }),
    prisma.dmLog.count({ where: { workspaceId, status: "SENT" } }),
    prisma.dmLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { automation: { select: { name: true } } },
    }),
  ]);

  const dailyDMs: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(todayStart);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const count = await prisma.dmLog.count({
      where: {
        workspaceId,
        status: "SENT",
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });

    dailyDMs.push({
      date: dayStart.toLocaleDateString("en-US", { weekday: "short" }),
      count,
    });
  }

  const effectivePlan = workspace
    ? getEffectivePlan(workspace.plan, workspace.subscriptionStatus)
    : "FREE";

  return NextResponse.json({
    success: true,
    data: {
      workspace,
      instagramAccount,
      plan: effectivePlan,
      planLimits: PLAN_LIMITS[effectivePlan],
      totalAutomations,
      activeAutomations,
      dmsSentToday,
      dmsSentWeek,
      dmsSentMonth,
      totalDMs,
      dailyDMs,
      recentLogs,
    },
  });
}
