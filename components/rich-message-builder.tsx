"use client";

import type { DmCard, DmUrlButton, DmMessageType } from "@/lib/types/dm-message";
import { emptyCard, emptyButton } from "@/lib/types/dm-message";

interface RichMessageBuilderProps {
  messageType: DmMessageType;
  onTypeChange: (t: DmMessageType) => void;
  // TEXT
  dmMessage: string;
  onDmMessageChange: (v: string) => void;
  // CARD
  card: DmCard;
  onCardChange: (card: DmCard) => void;
  // CAROUSEL
  carouselCards: DmCard[];
  onCarouselChange: (cards: DmCard[]) => void;
}

function ButtonEditor({
  button,
  onChange,
  onRemove,
}: {
  button: DmUrlButton;
  onChange: (b: DmUrlButton) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-2 items-start">
      <div className="flex-1 grid grid-cols-2 gap-2">
        <input
          type="text"
          value={button.title}
          onChange={(e) => onChange({ ...button, title: e.target.value })}
          placeholder="Button label"
          maxLength={20}
          className="px-3 py-1.5 rounded-lg bg-surface border border-border text-xs text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
        />
        <input
          type="url"
          value={button.url}
          onChange={(e) => onChange({ ...button, url: e.target.value })}
          placeholder="https://..."
          className="px-3 py-1.5 rounded-lg bg-surface border border-border text-xs text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="mt-0.5 p-1.5 rounded-lg text-zinc-500 hover:text-error hover:bg-error/10 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function CardEditor({
  card,
  onChange,
  label,
  onRemove,
}: {
  card: DmCard;
  onChange: (c: DmCard) => void;
  label?: string;
  onRemove?: () => void;
}) {
  function updateButton(idx: number, b: DmUrlButton) {
    const buttons = card.buttons.map((btn, i) => (i === idx ? b : btn));
    onChange({ ...card, buttons });
  }

  function removeButton(idx: number) {
    onChange({ ...card, buttons: card.buttons.filter((_, i) => i !== idx) });
  }

  function addButton() {
    if (card.buttons.length >= 3) return;
    onChange({ ...card, buttons: [...card.buttons, emptyButton()] });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      {label && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">{label}</p>
          {onRemove && (
            <button type="button" onClick={onRemove}
              className="text-xs text-zinc-500 hover:text-error transition-colors">
              Remove card
            </button>
          )}
        </div>
      )}

      {/* Card preview */}
      <div className="rounded-xl border border-border bg-surface-hover overflow-hidden max-w-xs">
        {card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrl} alt="" className="w-full h-28 object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-full h-16 bg-gradient-to-br from-indigo-500/15 to-violet-500/15 flex items-center justify-center">
            <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
          </div>
        )}
        <div className="p-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-foreground line-clamp-1">{card.title || "Card title"}</p>
          {card.subtitle && <p className="text-[11px] text-muted line-clamp-2">{card.subtitle}</p>}
          {card.buttons.map((btn, i) => (
            <div key={i} className="rounded-md border border-accent/30 bg-accent/10 py-1 text-center">
              <span className="text-[11px] font-medium text-accent">{btn.title || "Button"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-2">
        <div>
          <label className="text-[11px] font-medium text-muted">Title <span className="text-error">*</span></label>
          <input type="text" value={card.title}
            onChange={(e) => onChange({ ...card, title: e.target.value })}
            placeholder="e.g. Here's your exclusive resource!"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-hover border border-border text-xs text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted">Subtitle <span className="text-zinc-600 font-normal">(optional)</span></label>
          <input type="text" value={card.subtitle}
            onChange={(e) => onChange({ ...card, subtitle: e.target.value })}
            placeholder="A short description"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-hover border border-border text-xs text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted">Image URL <span className="text-zinc-600 font-normal">(optional)</span></label>
          <input type="url" value={card.imageUrl}
            onChange={(e) => onChange({ ...card, imageUrl: e.target.value })}
            placeholder="https://yourdomain.com/image.jpg"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-hover border border-border text-xs text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
          />
        </div>

        {/* Buttons */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-muted">Buttons (up to 3)</label>
            {card.buttons.length < 3 && (
              <button type="button" onClick={addButton}
                className="text-[11px] text-accent hover:underline">
                + Add button
              </button>
            )}
          </div>
          {card.buttons.map((btn, i) => (
            <ButtonEditor key={i} button={btn}
              onChange={(b) => updateButton(i, b)}
              onRemove={() => removeButton(i)} />
          ))}
          {card.buttons.length === 0 && (
            <p className="text-[11px] text-zinc-600">No buttons — card will show text only.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RichMessageBuilder({
  messageType, onTypeChange,
  dmMessage, onDmMessageChange,
  card, onCardChange,
  carouselCards, onCarouselChange,
}: RichMessageBuilderProps) {
  const types: { id: DmMessageType; label: string; desc: string }[] = [
    { id: "TEXT", label: "Text", desc: "Plain text with {username} and {link} tokens." },
    { id: "CARD", label: "Card", desc: "Rich card with image, title, subtitle, and buttons." },
    { id: "CAROUSEL", label: "Carousel", desc: "Multiple swipeable cards." },
  ];

  function addCarouselCard() {
    if (carouselCards.length >= 10) return;
    onCarouselChange([...carouselCards, emptyCard()]);
  }

  function updateCarouselCard(idx: number, c: DmCard) {
    onCarouselChange(carouselCards.map((card, i) => (i === idx ? c : card)));
  }

  function removeCarouselCard(idx: number) {
    onCarouselChange(carouselCards.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-4">
      {/* Type picker */}
      <div className="flex gap-2">
        {types.map((t) => (
          <button key={t.id} type="button"
            onClick={() => onTypeChange(t.id)}
            className={`flex-1 rounded-xl border px-3 py-3 text-left transition-colors ${
              messageType === t.id
                ? "border-accent/60 bg-accent/10"
                : "border-border bg-surface text-muted hover:border-border-hover"
            }`}
          >
            <p className={`text-xs font-semibold ${messageType === t.id ? "text-accent" : ""}`}>{t.label}</p>
            <p className="text-[11px] text-muted mt-0.5 leading-4">{t.desc}</p>
          </button>
        ))}
      </div>

      {/* TEXT */}
      {messageType === "TEXT" && (
        <div className="space-y-1">
          <textarea
            value={dmMessage}
            onChange={(e) => onDmMessageChange(e.target.value)}
            placeholder="Hey {username}! Here's the link you asked for: {link}"
            rows={4}
            className="w-full px-4 py-3 rounded-xl bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors resize-none"
            maxLength={1000}
          />
          <p className="text-xs text-muted">
            Use{" "}
            <code className="px-1 py-0.5 rounded bg-surface-hover text-accent font-mono text-[11px]">{"{username}"}</code>
            {" "}and{" "}
            <code className="px-1 py-0.5 rounded bg-surface-hover text-accent font-mono text-[11px]">{"{link}"}</code>
            {" "}to personalize.
          </p>
        </div>
      )}

      {/* CARD */}
      {messageType === "CARD" && (
        <CardEditor card={card} onChange={onCardChange} />
      )}

      {/* CAROUSEL */}
      {messageType === "CAROUSEL" && (
        <div className="space-y-3">
          {carouselCards.map((c, i) => (
            <CardEditor
              key={i}
              card={c}
              label={`Card ${i + 1}`}
              onChange={(updated) => updateCarouselCard(i, updated)}
              onRemove={carouselCards.length > 1 ? () => removeCarouselCard(i) : undefined}
            />
          ))}
          {carouselCards.length < 10 && (
            <button type="button" onClick={addCarouselCard}
              className="w-full rounded-xl border border-dashed border-border py-3 text-xs text-muted hover:border-accent/40 hover:text-accent transition-colors">
              + Add card
            </button>
          )}
        </div>
      )}
    </div>
  );
}
