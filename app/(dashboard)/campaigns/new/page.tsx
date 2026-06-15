"use client";

/**
 * New Campaign Page
 *
 * Form to create a new campaign with goal, account, post picker, keywords, DM message, and active state.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import KeywordInput from "@/components/keyword-input";
import PostPicker from "@/components/post-picker";
import RichMessageBuilder from "@/components/rich-message-builder";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";
import {
  extractFirstUrl,
  replaceUrlWithTrackedPlaceholder,
} from "@/lib/tracking/message";
import { emptyCard, type DmCard, type DmMessageType } from "@/lib/types/dm-message";

export default function NewCampaignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedTemplate = getCampaignTemplate(searchParams.get("template"));
  const templateDestinationUrl = selectedTemplate
    ? extractFirstUrl(selectedTemplate.dmMessage)
    : null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(selectedTemplate?.title ?? "");
  const [goal, setGoal] = useState(selectedTemplate?.goal ?? "");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | undefined>();
  const [keywords, setKeywords] = useState<string[]>(
    selectedTemplate?.keywords ?? []
  );
  const [dmMessage, setDmMessage] = useState(
    selectedTemplate
      ? replaceUrlWithTrackedPlaceholder(
          selectedTemplate.dmMessage,
          templateDestinationUrl
        )
      : ""
  );
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState(
    templateDestinationUrl ?? ""
  );
  const [wholeWordMatch, setWholeWordMatch] = useState(true);
  const [isActive, setIsActive] = useState(true);

  // Comment reply (public)
  const [commentReplyEnabled, setCommentReplyEnabled] = useState(false);
  const [commentReplies, setCommentReplies] = useState<string[]>([]);
  const [newReplyText, setNewReplyText] = useState("");

  // Private reply message type
  const [dmMessageType, setDmMessageType] = useState<DmMessageType>("TEXT");
  const [cardData, setCardData] = useState<DmCard>(emptyCard());
  const [carouselCards, setCarouselCards] = useState<DmCard[]>([emptyCard()]);

  // Message flow
  type MessageFlow = "simple" | "welcome" | "follow_check";
  const [messageFlow, setMessageFlow] = useState<MessageFlow>("simple");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [welcomeImageUrl, setWelcomeImageUrl] = useState("");
  const [welcomeButtonText, setWelcomeButtonText] = useState("Send me Link ✨");
  const [followCheckMessage, setFollowCheckMessage] = useState("");
  const [followCheckButtonText, setFollowCheckButtonText] = useState("I'm Following ✅");

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) {
          const nextAccounts = payload.data.instagramAccounts ?? [];
          setAccounts(nextAccounts);
          setSelectedAccountId(
            payload.data.selectedInstagramAccountId ??
              nextAccounts[0]?.id ??
              ""
          );
        }
      })
      .catch(() => {
        setAccounts([]);
        setSelectedAccountId("");
      });
  }, []);

  function handleAccountChange(accountId: string) {
    setSelectedAccountId(accountId);
    setPostId(null);
    setPostUrl(undefined);
  }

  function buildDmMessagePayload() {
    if (dmMessageType === "CARD") return cardData;
    if (dmMessageType === "CAROUSEL") return { cards: carouselCards };
    return null;
  }

  function getDmMessagePreview() {
    if (dmMessageType === "CARD") return cardData.title || dmMessage;
    if (dmMessageType === "CAROUSEL") return carouselCards[0]?.title || dmMessage;
    return dmMessage;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const previewMessage = getDmMessagePreview();
    if (!name || !goal || !postId || keywords.length === 0 || !previewMessage) {
      setError("Please fill in all required fields");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          goal,
          instagramAccountId: selectedAccountId,
          postId,
          postUrl: postUrl ?? null,
          keywords,
          dmMessage: getDmMessagePreview(),
          trackedDestinationUrl: trackedDestinationUrl || null,
          wholeWordMatch,
          isActive,
          // Comment reply
          commentReplyEnabled,
          commentReplies,
          // Rich DM
          dmMessageType,
          dmMessagePayload: buildDmMessagePayload(),
          // Message flow
          welcomeEnabled: messageFlow === "welcome",
          welcomeMessage: messageFlow === "welcome" ? (welcomeMessage || null) : null,
          welcomeImageUrl: messageFlow === "welcome" ? (welcomeImageUrl || null) : null,
          welcomeButtonText: messageFlow === "welcome" ? (welcomeButtonText || null) : null,
          followCheckEnabled: messageFlow === "follow_check",
          followCheckMessage: messageFlow === "follow_check" ? (followCheckMessage || null) : null,
          followCheckButtonText: messageFlow === "follow_check" ? (followCheckButtonText || null) : null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        router.push("/campaigns");
      } else {
        setError(data.error ?? "Failed to create campaign");
      }
    } catch {
      setError("Failed to create campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <form onSubmit={handleSubmit} className="space-y-8">
        {error && (
          <div className="p-4 rounded-xl bg-error/10 border border-error/20 text-error text-sm">
            {error}
          </div>
        )}

        {selectedTemplate && (
          <div className="border border-cyan-200/20 bg-cyan-300/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-100">
              Template loaded
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {selectedTemplate.title}
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-300">
              Pick the Instagram post or reel, adjust the copy, and launch when
              the connection is ready.
            </p>
          </div>
        )}

        {/* Name */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Campaign Name <span className="text-error">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Product launch link drop"
            className="w-full px-4 py-3 rounded-xl bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
            maxLength={100}
          />
        </div>

        {/* Goal */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Campaign Goal <span className="text-error">*</span>
          </label>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-surface border border-border text-sm text-foreground focus:border-accent/40 focus:outline-none transition-colors"
          >
            <option value="">Select a goal</option>
            <option value="Lead magnet delivery">Lead magnet delivery</option>
            <option value="Product link request">Product link request</option>
            <option value="Price or availability reply">Price or availability reply</option>
            <option value="Launch waitlist">Launch waitlist</option>
            <option value="Agency client campaign">Agency client campaign</option>
          </select>
        </div>

        {/* Instagram Account */}
        <div className="space-y-2">
          <p className="block text-sm font-medium text-foreground">
            Instagram Account <span className="text-error">*</span>
          </p>
          {accounts.length > 0 ? (
            <AccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={handleAccountChange}
              includeAll={false}
              label="Connected profile"
            />
          ) : (
            <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground">
              Connect Instagram before launching a campaign
            </div>
          )}
        </div>

        {/* Post Picker */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Campaign Post Or Reel <span className="text-error">*</span>
          </label>
          <p className="text-xs text-muted mb-3">
            Choose which Instagram post or reel should trigger the campaign.
          </p>
          <div className="glass rounded-xl p-4">
            <PostPicker
              selectedPostId={postId}
              instagramAccountId={selectedAccountId}
              onSelect={(id, url) => {
                setPostId(id);
                setPostUrl(url);
              }}
            />
          </div>
        </div>

        {/* Keywords */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Comment Keywords <span className="text-error">*</span>
          </label>
          <p className="text-xs text-muted mb-1">
            When someone comments any of these keywords, the campaign sends the private reply.
          </p>
          <KeywordInput keywords={keywords} onChange={setKeywords} />
        </div>

        {/* Comment Reply (public) */}
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              type="button"
              onClick={() => setCommentReplyEnabled(!commentReplyEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${commentReplyEnabled ? "bg-accent" : "bg-zinc-700"}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${commentReplyEnabled ? "left-6" : "left-1"}`} />
            </button>
            <div>
              <span className="text-sm font-medium text-foreground">Reply to comment publicly</span>
              <p className="text-xs text-muted">Post a public reply on the comment (visible to everyone).</p>
            </div>
          </label>
          {commentReplyEnabled && (
            <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
              <p className="text-xs text-muted">Add reply texts — one will be chosen at random each time. Use <code className="px-1 rounded bg-surface-hover text-accent font-mono text-[11px]">{"{username}"}</code> to personalize.</p>
              {commentReplies.map((reply, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={reply}
                    onChange={(e) => setCommentReplies(commentReplies.map((r, idx) => idx === i ? e.target.value : r))}
                    className="flex-1 px-3 py-2 rounded-xl bg-surface-hover border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    maxLength={300}
                  />
                  <button type="button" onClick={() => setCommentReplies(commentReplies.filter((_, idx) => idx !== i))}
                    className="p-2 rounded-lg text-zinc-500 hover:text-error hover:bg-error/10 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {commentReplies.length < 10 && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newReplyText}
                    onChange={(e) => setNewReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newReplyText.trim()) {
                        e.preventDefault();
                        setCommentReplies([...commentReplies, newReplyText.trim()]);
                        setNewReplyText("");
                      }
                    }}
                    placeholder="Type a reply and press Enter…"
                    className="flex-1 px-3 py-2 rounded-xl bg-surface-hover border border-dashed border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    maxLength={300}
                  />
                  <button type="button"
                    onClick={() => { if (newReplyText.trim()) { setCommentReplies([...commentReplies, newReplyText.trim()]); setNewReplyText(""); } }}
                    className="px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted hover:text-foreground hover:border-border-hover transition-colors">
                    Add
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Private Reply Message */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Private Reply Message <span className="text-error">*</span>
          </label>
          <RichMessageBuilder
            messageType={dmMessageType}
            onTypeChange={setDmMessageType}
            dmMessage={dmMessage}
            onDmMessageChange={setDmMessage}
            card={cardData}
            onCardChange={setCardData}
            carouselCards={carouselCards}
            onCarouselChange={setCarouselCards}
          />
        </div>

        {/* Message Flow */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground">
              Message Flow
            </label>
            <p className="mt-1 text-xs text-muted">
              Choose how the campaign sends replies after a keyword match.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                {
                  id: "simple",
                  label: "Direct DM",
                  desc: "Send the private reply message immediately — no extra steps.",
                  icon: (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.794 1.661 3.241 3.71 3.241H13.5l4.5 2.25v-2.25h.39C20.661 16 22.5 14.553 22.5 12.76V7.49C22.5 5.697 20.659 4.25 18.61 4.25H5.39C3.341 4.25 1.5 5.697 1.5 7.49v4.271Z" />
                    </svg>
                  ),
                },
                {
                  id: "welcome",
                  label: "Send me Link",
                  desc: "Show a welcome card with an image + button. Send the DM only when the user clicks.",
                  icon: (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                    </svg>
                  ),
                },
                {
                  id: "follow_check",
                  label: "Follow Gate",
                  desc: "Ask the commenter to follow your account first, then comment again to get the DM.",
                  icon: (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
                    </svg>
                  ),
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMessageFlow(opt.id as MessageFlow)}
                className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
                  messageFlow === opt.id
                    ? "border-accent/60 bg-accent/10 text-foreground"
                    : "border-border bg-surface text-muted hover:border-border-hover hover:text-foreground"
                }`}
              >
                <span className={messageFlow === opt.id ? "text-accent" : ""}>{opt.icon}</span>
                <span className="text-sm font-semibold">{opt.label}</span>
                <span className="text-xs leading-5">{opt.desc}</span>
              </button>
            ))}
          </div>

          {/* Welcome message builder */}
          {messageFlow === "welcome" && (
            <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                Welcome card
              </p>

              {/* Preview */}
              <div className="rounded-xl border border-border bg-surface-hover overflow-hidden max-w-xs">
                {welcomeImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={welcomeImageUrl}
                    alt="Welcome card preview"
                    className="w-full h-36 object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                {!welcomeImageUrl && (
                  <div className="w-full h-24 bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                  </div>
                )}
                <div className="p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground line-clamp-2">
                    {welcomeMessage || "Hey there! Click below to get your link."}
                  </p>
                  <div className="rounded-lg border border-accent/40 bg-accent/10 py-1.5 text-center">
                    <span className="text-xs font-semibold text-accent">
                      {welcomeButtonText || "Send me Link ✨"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Welcome message text</label>
                  <textarea
                    value={welcomeMessage}
                    onChange={(e) => setWelcomeMessage(e.target.value)}
                    placeholder="Hey {username}! Click below to get your exclusive link 🎉"
                    rows={2}
                    maxLength={500}
                    className="w-full px-3 py-2 rounded-xl bg-surface-hover border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors resize-none"
                  />
                  <p className="text-xs text-muted">Use <code className="px-1 rounded bg-surface text-accent font-mono text-[11px]">{"{username}"}</code> to personalize.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Image URL <span className="text-muted font-normal">(optional)</span></label>
                  <input
                    type="url"
                    value={welcomeImageUrl}
                    onChange={(e) => setWelcomeImageUrl(e.target.value)}
                    placeholder="https://yourdomain.com/promo-image.jpg"
                    className="w-full px-3 py-2 rounded-xl bg-surface-hover border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Button label</label>
                  <input
                    type="text"
                    value={welcomeButtonText}
                    onChange={(e) => setWelcomeButtonText(e.target.value)}
                    placeholder="Send me Link ✨"
                    maxLength={20}
                    className="w-full px-3 py-2 rounded-xl bg-surface-hover border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
                  />
                  <p className="text-xs text-muted">Max 20 characters. This button triggers the DM with the private reply message above.</p>
                </div>
              </div>
            </div>
          )}

          {/* Follow check builder */}
          {messageFlow === "follow_check" && (
            <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                Follow gate card
              </p>
              <p className="text-xs text-muted">
                Sends a card with a button. When the commenter clicks the button ("I'm Following"), the system sends them the private reply message above.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Card message</label>
                <textarea
                  value={followCheckMessage}
                  onChange={(e) => setFollowCheckMessage(e.target.value)}
                  placeholder={`Hey {username}! To get this content, please follow our account first 💙`}
                  rows={2}
                  maxLength={500}
                  className="w-full px-3 py-2 rounded-xl bg-surface-hover border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors resize-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Button label</label>
                <input
                  type="text"
                  value={followCheckButtonText}
                  onChange={(e) => setFollowCheckButtonText(e.target.value)}
                  placeholder="I'm Following ✅"
                  maxLength={20}
                  className="w-full px-3 py-2 rounded-xl bg-surface-hover border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
                />
                <p className="text-xs text-muted">When clicked, the system sends the private reply message. Max 20 characters.</p>
              </div>
              {/* Preview */}
              <div className="rounded-xl border border-border bg-surface-hover p-3 max-w-xs space-y-2">
                <p className="text-xs text-foreground">{followCheckMessage || `Hey there! Please follow our account first 💙`}</p>
                <div className="rounded-lg border border-accent/40 bg-accent/10 py-1.5 text-center">
                  <span className="text-xs font-semibold text-accent">{followCheckButtonText || "I'm Following ✅"}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tracked Link */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Tracked Destination URL
          </label>
          <input
            type="url"
            value={trackedDestinationUrl}
            onChange={(e) => setTrackedDestinationUrl(e.target.value)}
            placeholder="https://yourlink.com/offer"
            className="w-full px-4 py-3 rounded-xl bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              Add <code className="px-1 py-0.5 rounded bg-surface-hover text-accent font-mono text-[11px]">{"{link}"}</code> to send the tracked redirect.
            </p>
            <button
              type="button"
              onClick={() =>
                setDmMessage((current) =>
                  current.includes("{link}") ? current : `${current.trim()} {link}`.trim()
                )
              }
              className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
            >
              Insert link token
            </button>
          </div>
        </div>

        {/* Options */}
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer group">
            <button
              type="button"
              onClick={() => setWholeWordMatch(!wholeWordMatch)}
              className={`
                relative w-11 h-6 rounded-full transition-colors
                ${wholeWordMatch ? "bg-accent" : "bg-zinc-700"}
              `}
            >
              <span
                className={`
                  absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm
                  ${wholeWordMatch ? "left-6" : "left-1"}
                `}
              />
            </button>
            <div>
              <span className="text-sm font-medium text-foreground">Whole word match</span>
              <p className="text-xs text-muted">
                {wholeWordMatch
                  ? '"linking" won\'t trigger "LINK"'
                  : '"linking" WILL trigger "LINK"'}
              </p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer group">
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`
                relative w-11 h-6 rounded-full transition-colors
                ${isActive ? "bg-accent" : "bg-zinc-700"}
              `}
            >
              <span
                className={`
                  absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm
                  ${isActive ? "left-6" : "left-1"}
                `}
              />
            </button>
            <div>
              <span className="text-sm font-medium text-foreground">Launch active</span>
              <p className="text-xs text-muted">
                {isActive ? "Campaign starts listening after creation" : "Campaign is saved paused"}
              </p>
            </div>
          </label>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4 pt-4 border-t border-border">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            {saving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating...
              </>
            ) : (
              "Create Campaign"
            )}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-3 rounded-xl text-sm font-medium text-muted hover:text-foreground hover:bg-surface-hover border border-border transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
