export interface Point {
  x: number;
  y: number;
}

export type Anchor = Point | HTMLElement | DOMRect;

/**
 * Yüzen öğeyi (menü, açılır panel) çapanın altına/sağına yerleştirir; pencereye sığmazsa çevirir.
 * `align`: çapa öğeyse menünün sol (start) ya da sağ (end) kenarı hizalanır.
 */
export function place(floating: HTMLElement, anchor: Anchor, align: "start" | "end" = "start", gap = 4): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { width, height } = floating.getBoundingClientRect();
  let x: number;
  let y: number;
  let flipY: number;
  if (anchor instanceof HTMLElement || anchor instanceof DOMRect) {
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    x = align === "end" ? r.right - width : r.left;
    y = r.bottom + gap;
    flipY = r.top - gap - height;
  } else {
    x = anchor.x;
    y = anchor.y;
    flipY = anchor.y - height;
  }
  if (y + height > vh - 8 && flipY >= 8) y = flipY;
  y = Math.max(8, Math.min(y, vh - height - 8));
  x = Math.max(8, Math.min(x, vw - width - 8));
  floating.style.left = `${Math.round(x)}px`;
  floating.style.top = `${Math.round(y)}px`;
}
