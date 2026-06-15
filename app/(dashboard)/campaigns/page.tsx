"use client";

/**
 * Campaigns List Page
 *
 * Shows all campaigns as cards with toggle and delete.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";

interface Campaign {
  id: string;
  name: string;
  goal: string | null;
  postId: string;
  postUrl: string | null;
  keywords: string[];
  dmMessage: string;
  isActive: boolean;
  wholeWordMatch: boolean;
  welcomeEnabled: boolean;
  followCheckEnabled: boolean;
  instagramAccount: {
    username: string;
    instagramId: string;
  };
  reportShareSlug: string | null;
  reportShareEnabled: boolean;
  reportUrl: string | null;
  createdAt: string;
  _count: { dmLogs: number };
  trackedLinks: Array<{
    id: string;
    slug: string;
    destinationUrl: string;
    trackedUrl: string;
    _count: { clicks: number };
  }>;
  analytics: {
    sent: number;
    skipped: number;
    failed: number;
    clicks: number;
    ctr: number;
    topKeywords: { keyword: string; count: number }[];
  };
}

export default function CampaignsPage() {
  const [automations, setAutomations] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [testState, setTestState] = useState<Record<string, "idle" | "loading" | "ok" | "error">>({});

  const fetchAutomations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedAccountId !== "all") {
        params.set("instagramAccountId", selectedAccountId);
      }
      const res = await fetch(`/api/automations${params.size ? `?${params}` : ""}`);
      const data = await res.json();
      if (data.success) setAutomations(data.data);
    } catch (err) {
      console.error("Failed to fetch campaigns:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAutomations();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAutomations]);

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
  }

  async function toggleActive(id: string, isActive: boolean) {
    try {
      await fetch(`/api/automations?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, isActive: !isActive } : a))
      );
    } catch (err) {
      console.error("Failed to toggle:", err);
    }
  }

  async function toggleReport(id: string, reportShareEnabled: boolean) {
    try {
      await fetch(`/api/automations?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportShareEnabled: !reportShareEnabled }),
      });
      setAutomations((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, reportShareEnabled: !reportShareEnabled }
            : a
        )
      );
    } catch (err) {
      console.error("Failed to toggle report:", err);
    }
  }

  async function deleteAutomation(id: string) {
    if (!confirm("Delete this campaign? This cannot be undone.")) return;
    try {
      await fetch(`/api/automations?id=${id}`, { method: "DELETE" });
      setAutomations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }

  async function testCampaign(id: string) {
    setTestState((prev) => ({ ...prev, [id]: "loading" }));
    try {
      const res = await fetch(`/api/automations/test?id=${id}`, { method: "POST" });
      const data = await res.json();
      setTestState((prev) => ({ ...prev, [id]: data.success ? "ok" : "error" }));
    } catch {
      setTestState((prev) => ({ ...prev, [id]: "error" }));
    }
    setTimeout(() => setTestState((prev) => ({ ...prev, [id]: "idle" })), 3000);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="glass rounded-2xl p-6 h-36 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted">
            {automations.length} campaign{automations.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={handleAccountChange}
            />
          )}
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Campaign
          </Link>
        </div>
      </div>

      {/* Empty state */}
      {automations.length === 0 && (
        <div className="glass rounded-2xl p-12 text-center animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 mb-4">
            <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">No campaigns yet</h3>
          <p className="text-sm text-muted mb-6 max-w-sm mx-auto">
            Create your first comment-to-DM campaign to turn a post or reel into a measurable conversation flow.
          </p>
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-sm font-semibold text-white hover:bg-accent-hover transition-colors"
          >
            Create Campaign
          </Link>
        </div>
      )}

      {/* Campaign cards */}
      <div className="space-y-4 stagger">
        {automations.map((auto) => (
          <div key={auto.id} className="glass rounded-2xl p-6 animate-fade-in hover:border-border-hover transition-all">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-base font-semibold truncate">{auto.name}</h3>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                    @{auto.instagramAccount.username}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      auto.isActive
                        ? "bg-success/10 text-success"
                        : "bg-zinc-500/10 text-zinc-400"
                    }`}
                  >
                    {auto.isActive ? "Active" : "Paused"}
                  </span>
                </div>

                {auto.goal && (
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-accent">
                    {auto.goal}
                  </p>
                )}

                {/* Keywords */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {auto.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="px-2 py-0.5 rounded-md bg-accent/10 text-accent text-xs font-medium border border-accent/10"
                    >
                      {kw}
                    </span>
                  ))}
                </div>

                {/* DM preview */}
                <p className="text-sm text-muted truncate">&ldquo;{auto.dmMessage}&rdquo;</p>

                {/* Stats */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-zinc-500">
                  <span>{auto.analytics.sent} sent</span>
                  <span>·</span>
                  <span>{auto.analytics.skipped} skipped</span>
                  <span>·</span>
                  <span>{auto.analytics.failed} failed</span>
                  <span>·</span>
                  <span>{auto.analytics.clicks} clicks</span>
                  <span>·</span>
                  <span>{auto.analytics.ctr}% CTR</span>
                  <span>·</span>
                  <span>{auto.wholeWordMatch ? "Whole word" : "Partial match"}</span>
                </div>

                {auto.trackedLinks[0] && (
                  <div className="mt-4 rounded-xl border border-border bg-surface/70 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Tracked link
                        </p>
                        <p className="mt-1 truncate text-xs text-muted">
                          {auto.trackedLinks[0].trackedUrl}
                        </p>
                      </div>
                      <a
                        href={auto.trackedLinks[0].trackedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                      >
                        Open
                      </a>
                    </div>
                  </div>
                )}

                {auto.reportUrl && (
                  <div className="mt-4 rounded-xl border border-border bg-surface/70 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Client report
                        </p>
                        <p className="mt-1 truncate text-xs text-muted">
                          {auto.reportUrl}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            toggleReport(auto.id, auto.reportShareEnabled)
                          }
                          className={`inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            auto.reportShareEnabled
                              ? "border-success/20 text-success hover:bg-success/10"
                              : "border-border text-muted hover:border-border-hover hover:text-foreground"
                          }`}
                        >
                          {auto.reportShareEnabled ? "Public" : "Disabled"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void navigator.clipboard?.writeText(auto.reportUrl ?? "")
                          }
                          className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                        >
                          Copy
                        </button>
                        <a
                          href={auto.reportUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                        >
                          View
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {auto.analytics.topKeywords.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {auto.analytics.topKeywords.map((keyword) => (
                      <span
                        key={keyword.keyword}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted"
                      >
                        {keyword.keyword}: {keyword.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Toggle */}
                <button
                  onClick={() => toggleActive(auto.id, auto.isActive)}
                  title={auto.isActive ? "Pause campaign" : "Activate campaign"}
                  className={`
                    relative w-11 h-6 rounded-full transition-colors
                    ${auto.isActive ? "bg-accent" : "bg-zinc-700"}
                  `}
                >
                  <span
                    className={`
                      absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm
                      ${auto.isActive ? "left-6" : "left-1"}
                    `}
                  />
                </button>

                {/* Test */}
                <button
                  type="button"
                  onClick={() => void testCampaign(auto.id)}
                  disabled={testState[auto.id] === "loading"}
                  title="Send test DM to tester account"
                  className={`p-2 rounded-lg transition-colors ${
                    testState[auto.id] === "ok"
                      ? "text-success bg-success/10"
                      : testState[auto.id] === "error"
                      ? "text-error bg-error/10"
                      : "text-zinc-500 hover:text-foreground hover:bg-surface-hover"
                  }`}
                >
                  {testState[auto.id] === "loading" ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : testState[auto.id] === "ok" ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : testState[auto.id] === "error" ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                  )}
                </button>

                {/* Edit */}
                <Link
                  href={`/campaigns/${auto.id}/edit`}
                  title="Edit campaign"
                  className="p-2 rounded-lg text-zinc-500 hover:text-foreground hover:bg-surface-hover transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                  </svg>
                </Link>

                {/* Delete */}
                <button
                  onClick={() => deleteAutomation(auto.id)}
                  title="Delete campaign"
                  className="p-2 rounded-lg text-zinc-500 hover:text-error hover:bg-error/10 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
