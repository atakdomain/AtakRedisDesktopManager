// Komut kaydı: komut paleti (Ctrl+K) ve klavye kısayolları aynı listeden beslenir.
// Özellikler kendi komutlarını bileşen ömrü boyunca `useCommands([...])` ile kaydeder.
import type { Component } from "svelte";

export interface Command {
  id: string;
  title: () => string;
  /** Palette görünen grup adı */
  group?: () => string;
  /** "Mod+K", "Alt+C", "Shift+Delete", "F2" — Mod = Windows/Linux'ta Ctrl, macOS'ta Cmd */
  shortcut?: string;
  icon?: Component;
  when?: () => boolean;
  run: () => unknown;
  /** Odak bir metin alanındayken de kısayol çalışsın */
  inInputs?: boolean;
  /** Palette listelenmesin (yalnızca kısayol) */
  hidden?: boolean;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// Ham dizi: komut nesneleri vekile sarılmaz, kimlikle silinebilir
let registry = $state.raw<Command[]>([]);

export const palette = $state({ open: false, query: "", mode: "commands" as "commands" | "keys" });

export function allCommands(): Command[] {
  return registry.filter((c) => !c.hidden && (c.when?.() ?? true));
}

export function registerCommands(commands: Command[]): () => void {
  registry = [...registry, ...commands];
  return () => {
    registry = registry.filter((c) => !commands.includes(c));
  };
}

/** Bileşen içinde: bağlanınca kaydeder, yok olunca siler. */
export function useCommands(commands: Command[]): void {
  $effect(() => registerCommands(commands));
}

function eventCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let key = e.key;
  if (key.length === 1) key = key.toUpperCase();
  if (key === " ") key = "Space";
  // Alt+C gibi kombinasyonlarda bazı düzenler farklı karakter üretir; fiziksel tuşa düş
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  if (/^Digit\d$/.test(e.code) && (e.altKey || e.ctrlKey || e.metaKey)) key = e.code.slice(5);
  parts.push(key);
  return parts.join("+");
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest(".cm-editor")) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(target.type);
}

/** App.svelte'de window keydown'a bağlanır. Eşleşen ilk etkin komutu çalıştırır. */
export function handleShortcut(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  const combo = eventCombo(e);
  const inText = isTextTarget(e.target);
  for (let i = registry.length - 1; i >= 0; i--) {
    const command = registry[i];
    if (command.shortcut !== combo) continue;
    if (inText && !command.inInputs) continue;
    if (command.when && !command.when()) continue;
    e.preventDefault();
    e.stopPropagation();
    void command.run();
    return;
  }
}

/** Kısayolu platforma göre gösterir: Ctrl+Shift+K / ⌘⇧K */
export function formatShortcut(shortcut: string): string[] {
  return shortcut.split("+").map((part) => {
    if (part === "Mod") return isMac ? "⌘" : "Ctrl";
    if (isMac && part === "Alt") return "⌥";
    if (isMac && part === "Shift") return "⇧";
    if (part === "Delete") return isMac ? "⌦" : "Del";
    if (part === "ArrowUp") return "↑";
    if (part === "ArrowDown") return "↓";
    if (part === "Enter") return "↵";
    if (part === "Escape") return "Esc";
    return part;
  });
}
