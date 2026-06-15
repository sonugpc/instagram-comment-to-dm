export interface DmUrlButton {
  type: "web_url";
  title: string;
  url: string;
}

export interface DmCard {
  title: string;
  subtitle: string;
  imageUrl: string;
  buttons: DmUrlButton[];
}

export interface DmCardPayload {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: DmUrlButton[];
}

export interface DmCarouselPayload {
  cards: DmCard[];
}

export type DmMessageType = "TEXT" | "CARD" | "CAROUSEL";

export function emptyCard(): DmCard {
  return { title: "", subtitle: "", imageUrl: "", buttons: [] };
}

export function emptyButton(): DmUrlButton {
  return { type: "web_url", title: "", url: "" };
}
