import { prisma } from "@/lib/db/client";
import { getEffectivePlan, PLAN_LIMITS } from "@/lib/billing/plans";

export async function resetUsageIfNeeded(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { usagePeriodStart: true },
  });
  if (!workspace) return;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  if (workspace.usagePeriodStart < monthStart) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        usagePeriodStart: monthStart,
        dmsSentThisPeriod: 0,
      },
    });
  }
}

export async function canSendDMForWorkspace(workspaceId: string): Promise<{
  allowed: boolean;
  remaining: number;
  limit: number;
}> {
  await resetUsageIfNeeded(workspaceId);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      plan: true,
      subscriptionStatus: true,
      dmsSentThisPeriod: true,
    },
  });

  if (!workspace) {
    return { allowed: false, remaining: 0, limit: 0 };
  }

  const effectivePlan = getEffectivePlan(
    workspace.plan,
    workspace.subscriptionStatus
  );
  const limit = PLAN_LIMITS[effectivePlan].maxDMsPerMonth;
  const remaining = Math.max(0, limit - workspace.dmsSentThisPeriod);

  return {
    allowed: workspace.dmsSentThisPeriod < limit,
    remaining,
    limit,
  };
}

export async function incrementWorkspaceDMUsage(workspaceId: string) {
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { dmsSentThisPeriod: { increment: 1 } },
  });
}
