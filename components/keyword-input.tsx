"use client";

/**
 * Keyword Input
 *
 * Tag-style input for adding/removing keywords.
 */

import { useState, type KeyboardEvent } from "react";

interface KeywordInputProps {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  max?: number;
}

export default function KeywordInput({ keywords, onChange, max = 10 }: KeywordInputProps) {
  const [input, setInput] = useState("");

  function addKeyword(value: string) {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return;
    if (keywords.includes(trimmed)) return;
    if (keywords.length >= max) return;
    onChange([...keywords, trimmed]);
    setInput("");
  }

  function removeKeyword(keyword: string) {
    onChange(keywords.filter((k) => k !== keyword));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword(input);
    }
    if (e.key === "Backspace" && !input && keywords.length > 0) {
      removeKeyword(keywords[keywords.length - 1]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-surface border border-border focus-within:border-accent/40 transition-colors min-h-[48px]">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent/10 text-accent text-xs font-medium border border-accent/15"
          >
            {keyword}
            <button
              type="button"
              onClick={() => removeKeyword(keyword)}
              className="hover:text-error transition-colors ml-0.5"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addKeyword(input)}
          placeholder={keywords.length === 0 ? "Type keyword and press Enter..." : ""}
          className="flex-1 min-w-[120px] bg-transparent text-sm text-foreground placeholder:text-zinc-500 outline-none"
        />
      </div>
      <p className="text-xs text-muted">
        {keywords.length}/{max} keywords · Press Enter or comma to add
      </p>
    </div>
  );
}
