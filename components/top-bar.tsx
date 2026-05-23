"use client";

/**
 * Top Bar
 *
 * Page title, mobile hamburger, and connection status.
 */

import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/automations": "Automations",
  "/automations/new": "New Automation",
  "/logs": "DM Logs",
  "/settings": "Settings",
};

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
}

export default function TopBar({ onMenuClick, instagramUsername }: TopBarProps) {
  const pathname = usePathname();
  const title = pageTitles[pathname] ?? "Dashboard";

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 lg:px-8 border-b border-border glass">
      {/* Left: hamburger + title */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          aria-label="Toggle sidebar"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      </div>

      {/* Right: status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border text-xs text-muted">
          <div
            className={`w-2 h-2 rounded-full ${
              instagramUsername ? "bg-success animate-pulse" : "bg-warning"
            }`}
          />
          {instagramUsername ? `@${instagramUsername}` : "Connect Instagram"}
        </div>
      </div>
    </header>
  );
}
