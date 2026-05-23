import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  mockSendPrivateReply,
  mockDecryptToken,
  mockMatchKeywords,
  mockCheckRateLimit,
  mockIncrementDMCounter,
  mockQueueAdd,
  mockCanSendDMForWorkspace,
  mockIncrementWorkspaceDMUsage,
} = vi.hoisted(() => ({
  mockPrisma: {
    automation: {
      findMany: vi.fn(),
    },
    dmLog: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
  mockSendPrivateReply: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockMatchKeywords: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockIncrementDMCounter: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockCanSendDMForWorkspace: vi.fn(),
  mockIncrementWorkspaceDMUsage: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply: mockSendPrivateReply,
  MetaApiError: class MetaApiError extends Error {
    code: number;
    constructor(
      code: number,
      _subcode: number | undefined,
      _fbTraceId: string | undefined,
      message: string
    ) {
      super(message);
      this.code = code;
      this.name = "MetaApiError";
    }
  },
}));

vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: mockDecryptToken,
}));

vi.mock("@/lib/utils/keyword-matcher", () => ({
  matchKeywords: mockMatchKeywords,
}));

vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: mockCheckRateLimit,
  incrementDMCounter: mockIncrementDMCounter,
}));

vi.mock("@/lib/billing/usage", () => ({
  canSendDMForWorkspace: mockCanSendDMForWorkspace,
  incrementWorkspaceDMUsage: mockIncrementWorkspaceDMUsage,
}));

vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({
    add: mockQueueAdd,
  }),
  getRedisConnection: vi.fn(),
}));

vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__dmWorkerProcessor = processor;
    return {
      on: vi.fn(),
      close: vi.fn(),
    };
  }
  return {
    Worker: MockWorker,
  };
});

import { createDMWorker } from "../lib/queue/dm-worker";

const mockAutomation = {
  id: "auto_789",
  workspaceId: "workspace_123",
  instagramAccountId: "ig_account_row_1",
  postId: "media_101",
  keywords: ["LINK", "PRICE"],
  dmMessage: "Hey {username}! Here is the link: https://example.com",
  isActive: true,
  wholeWordMatch: true,
  instagramAccount: {
    id: "ig_account_row_1",
    instagramId: "ig_456",
    accessToken: "encrypted_token_abc",
  },
  workspace: {
    id: "workspace_123",
  },
};

const mockJobData = {
  instagramAccountId: "ig_456",
  commentId: "comment_555",
  commentText: "I want the LINK!",
  commenterId: "commenter_999",
  commenterName: "commenter_user",
  mediaId: "media_101",
};

function getProcessor(): (job: {
  data: typeof mockJobData;
  id: string;
  attemptsMade: number;
}) => Promise<void> {
  createDMWorker();
  return (global as Record<string, unknown>).__dmWorkerProcessor as (job: {
    data: typeof mockJobData;
    id: string;
    attemptsMade: number;
  }) => Promise<void>;
}

function createMockJob(data = mockJobData) {
  return {
    data,
    id: "job_001",
    attemptsMade: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.automation.findMany.mockResolvedValue([mockAutomation]);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.upsert.mockResolvedValue({});
  mockPrisma.dmLog.update.mockResolvedValue({});
  mockDecryptToken.mockReturnValue("decrypted_token");
  mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "LINK" });
  mockCanSendDMForWorkspace.mockResolvedValue({
    allowed: true,
    remaining: 100,
    limit: 2000,
  });
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    currentCount: 10,
    remainingDMs: 180,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
  });
  mockIncrementDMCounter.mockResolvedValue(11);
  mockIncrementWorkspaceDMUsage.mockResolvedValue({});
  mockSendPrivateReply.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_001",
  });
});

describe("DM Worker — Full Pipeline", () => {
  it("should send a private reply for a matching comment", async () => {
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith({
      where: {
        postId: "media_101",
        isActive: true,
        instagramAccount: { instagramId: "ig_456" },
      },
      include: {
        instagramAccount: true,
        workspace: true,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(mockMatchKeywords).toHaveBeenCalledWith(
      "I want the LINK!",
      ["LINK", "PRICE"],
      true
    );
    expect(mockPrisma.dmLog.findUnique).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "comment_555",
        },
      },
    });
    expect(mockCanSendDMForWorkspace).toHaveBeenCalledWith("workspace_123");
    expect(mockCheckRateLimit).toHaveBeenCalledWith("ig_456", 0);
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted_token_abc");
    expect(mockSendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the link: https://example.com"
    );
    expect(mockIncrementDMCounter).toHaveBeenCalledWith("ig_456");
    expect(mockIncrementWorkspaceDMUsage).toHaveBeenCalledWith("workspace_123");
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "comment_555",
        },
      },
      data: expect.objectContaining({ status: "SENT" }),
    });
  });

  it("should skip when no automations match the media", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).not.toHaveBeenCalled();
  });

  it("should skip when keywords do not match", async () => {
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should skip duplicate comments already sent", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({
      id: "existing_log",
      status: "SENT",
    });
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should requeue when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      currentCount: 190,
      remainingDMs: 0,
      shouldRequeue: true,
      requeueDelayMs: 1800000,
      shouldSkip: false,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({
        commentId: "comment_555",
        requeueAttempt: 1,
      }),
      expect.objectContaining({
        delay: 1800000,
        jobId: "comment:ig_456:comment_555:retry:1",
      })
    );
  });

  it("should skip with SKIPPED_RATE_LIMIT after max requeue attempts", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      currentCount: 190,
      remainingDMs: 0,
      shouldRequeue: false,
      requeueDelayMs: 0,
      shouldSkip: true,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "SKIPPED_RATE_LIMIT" }),
      })
    );
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should log FAILED when private reply sending fails and re-throw", async () => {
    const error = new Error("API Error");
    mockSendPrivateReply.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(processor(createMockJob())).rejects.toThrow("API Error");
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "comment_555",
        },
      },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "API Error",
      }),
    });
  });

  it("should handle missing access token", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        instagramAccount: {
          ...mockAutomation.instagramAccount,
          accessToken: null,
        },
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        }),
      })
    );
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should use 'there' when commenter name is not available", async () => {
    const processor = getProcessor();
    const jobDataWithoutName = {
      instagramAccountId: mockJobData.instagramAccountId,
      commentId: mockJobData.commentId,
      commentText: mockJobData.commentText,
      commenterId: mockJobData.commenterId,
      mediaId: mockJobData.mediaId,
    };

    await processor(createMockJob(jobDataWithoutName as typeof mockJobData));

    expect(mockSendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey there! Here is the link: https://example.com"
    );
  });
});
