// `use:tooltip={"metin"}` ya da `use:tooltip={{ text, shortcut }}` — tek bir <TooltipHost/> çizer.
import type { Action } from "svelte/action";

export interface TooltipContent {
  text: string;
  shortcut?: string;
}

export const tooltipState = $state<{ content: TooltipContent | null; rect: DOMRect | null }>({ content: null, rect: null });

let timer: ReturnType<typeof setTimeout> | undefined;
let owner: HTMLElement | null = null;

function hide(): void {
  clearTimeout(timer);
  owner = null;
  // Öğe şablon güncellemesi sırasında kaldırılırken çağrılabilir; durum yazımı sonraya ertelenir
  queueMicrotask(() => {
    if (owner === null) tooltipState.content = null;
  });
}

export const tooltip: Action<HTMLElement, string | TooltipContent | undefined | null> = (node, initial) => {
  let content = normalize(initial);

  function normalize(value: string | TooltipContent | undefined | null): TooltipContent | null {
    if (!value) return null;
    return typeof value === "string" ? { text: value } : value;
  }

  function show() {
    if (!content) return;
    clearTimeout(timer);
    // Bir ipucu zaten açıksa gecikmesiz geç (araç çubuğunda gezinirken)
    const delay = tooltipState.content ? 60 : 450;
    owner = node;
    timer = setTimeout(() => {
      if (owner !== node || !node.isConnected) return;
      tooltipState.rect = node.getBoundingClientRect();
      tooltipState.content = content;
    }, delay);
  }

  function leave() {
    if (owner === node) hide();
  }

  node.addEventListener("pointerenter", show);
  node.addEventListener("pointerleave", leave);
  node.addEventListener("pointerdown", leave);
  node.addEventListener("focusin", show);
  node.addEventListener("focusout", leave);

  return {
    update(value) {
      content = normalize(value);
      if (owner === node && tooltipState.content) tooltipState.content = content;
    },
    destroy() {
      leave();
      node.removeEventListener("pointerenter", show);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("pointerdown", leave);
      node.removeEventListener("focusin", show);
      node.removeEventListener("focusout", leave);
    },
  };
};
