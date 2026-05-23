"use client";

import { useEffect, useState } from "react";

interface SettingsData {
  workspace: {
    name: string;
    plan: string;
    subscriptionStatus: string;
    dmsSentThisPeriod: number;
  };
  instagramAccount: {
    username: string;
    instagramId: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
  } | null;
  plan: string;
  planLimits: {
    maxAutomations: number | null;
    maxDMsPerMonth: number;
  };
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setData(payload.data);
      })
      .finally(() => setLoading(false));
  }, []);

  async function disconnectInstagram() {
    if (!confirm("Disconnect Instagram? All campaigns will stop sending DMs.")) {
      return;
    }

    setBusy("disconnect");
    await fetch("/api/instagram/disconnect", { method: "POST" });
    window.location.reload();
  }

  async function startCheckout(plan: "PRO" | "AGENCY") {
    setBusy(plan);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const payload = await res.json();
    if (payload.url) window.location.assign(payload.url);
    setBusy(null);
  }

  async function openBillingPortal() {
    setBusy("portal");
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const payload = await res.json();
    if (payload.url) window.location.assign(payload.url);
    setBusy(null);
  }

  if (loading) {
    return <div className="glass rounded-2xl p-8 animate-pulse h-64" />;
  }

  const account = data?.instagramAccount;
  const usage = data
    ? `${data.workspace.dmsSentThisPeriod} / ${data.planLimits.maxDMsPerMonth}`
    : "0 / 0";

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <section className="glass rounded-2xl p-6">
        <h2 className="text-base font-semibold mb-6">Instagram Connection</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Status</p>
              <p className="text-xs text-muted mt-0.5">
                Comment webhooks and private replies depend on this connection.
              </p>
            </div>
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                account
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {account ? "Connected" : "Not connected"}
            </span>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Account</p>
              <p className="text-xs text-muted mt-0.5">
                Your linked Instagram professional profile
              </p>
            </div>
            <span className="text-sm text-muted">
              {account ? `@${account.username}` : "None"}
            </span>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Token Expires</p>
              <p className="text-xs text-muted mt-0.5">
                Daily cron refreshes tokens before expiry.
              </p>
            </div>
            <span className="text-sm text-muted">
              {account?.tokenExpiresAt
                ? new Date(account.tokenExpiresAt).toLocaleDateString()
                : "Not available"}
            </span>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border flex gap-3">
          <a
            href="/api/instagram/connect"
            className="px-4 py-2 rounded-xl text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            {account ? "Reconnect" : "Connect Instagram"}
          </a>
          {account && (
            <button
              onClick={disconnectInstagram}
              disabled={busy === "disconnect"}
              className="px-4 py-2 rounded-xl text-sm font-medium text-error hover:bg-error/10 border border-error/20 hover:border-error/40 transition-all disabled:opacity-50"
            >
              {busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
            </button>
          )}
        </div>
      </section>

      <section className="glass rounded-2xl p-6">
        <h2 className="text-base font-semibold mb-6">Billing</h2>

        <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border border-accent/15">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {data?.plan ?? "FREE"} Plan
              </p>
              <p className="text-xs text-muted mt-0.5">
                {usage} DMs used this month
              </p>
            </div>
            <button
              onClick={openBillingPortal}
              disabled={busy === "portal"}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-surface border border-border text-foreground hover:border-border-hover transition-colors disabled:opacity-50"
            >
              Billing Portal
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {[
            { plan: "PRO" as const, price: "$19/mo", features: "10 campaigns · 2,000 DMs/month" },
            { plan: "AGENCY" as const, price: "$49/mo", features: "Unlimited campaigns · 10,000 DMs/month" },
          ].map((tier) => (
            <div
              key={tier.plan}
              className="flex items-center justify-between py-3 border-b border-border last:border-0"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{tier.plan}</p>
                <p className="text-xs text-muted">{tier.features}</p>
              </div>
              <button
                onClick={() => startCheckout(tier.plan)}
                disabled={busy === tier.plan}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {busy === tier.plan ? "Opening..." : tier.price}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
