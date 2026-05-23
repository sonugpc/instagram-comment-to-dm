"use client";

/**
 * Automations List Page
 *
 * Shows all automations as cards with toggle, edit, delete.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Automation {
  id: string;
  name: string;
  postId: string;
  postUrl: string | null;
  keywords: string[];
  dmMessage: string;
  isActive: boolean;
  wholeWordMatch: boolean;
  createdAt: string;
  _count: { dmLogs: number };
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch("/api/automations");
      const data = await res.json();
      if (data.success) setAutomations(data.data);
    } catch (err) {
      console.error("Failed to fetch automations:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAutomations();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAutomations]);

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

  async function deleteAutomation(id: string) {
    if (!confirm("Delete this automation? This cannot be undone.")) return;
    try {
      await fetch(`/api/automations?id=${id}`, { method: "DELETE" });
      setAutomations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to delete:", err);
    }
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">
            {automations.length} automation{automations.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/automations/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Automation
        </Link>
      </div>

      {/* Empty state */}
      {automations.length === 0 && (
        <div className="glass rounded-2xl p-12 text-center animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 mb-4">
            <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">No automations yet</h3>
          <p className="text-sm text-muted mb-6 max-w-sm mx-auto">
            Create your first automation to start sending DMs when someone comments a keyword on your post.
          </p>
          <Link
            href="/automations/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-sm font-semibold text-white hover:bg-accent-hover transition-colors"
          >
            Create Automation
          </Link>
        </div>
      )}

      {/* Automation cards */}
      <div className="space-y-4 stagger">
        {automations.map((auto) => (
          <div key={auto.id} className="glass rounded-2xl p-6 animate-fade-in hover:border-border-hover transition-all">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-base font-semibold truncate">{auto.name}</h3>
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
                <div className="flex items-center gap-4 mt-3 text-xs text-zinc-500">
                  <span>{auto._count.dmLogs} DMs sent</span>
                  <span>·</span>
                  <span>{auto.wholeWordMatch ? "Whole word" : "Partial match"}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Toggle */}
                <button
                  onClick={() => toggleActive(auto.id, auto.isActive)}
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

                {/* Delete */}
                <button
                  onClick={() => deleteAutomation(auto.id)}
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
