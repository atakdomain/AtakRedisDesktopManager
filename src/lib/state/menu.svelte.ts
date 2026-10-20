// Tek bir açılır menü / bağlam menüsü; <MenuHost/> çizer.
import type { Component } from "svelte";
import type { Anchor } from "$lib/util/position";

export type MenuItem =
  | {
      kind?: "item";
      label: string;
      icon?: Component;
      shortcut?: string;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      /** Onay işareti gösterilir (aç/kapa seçenekleri) */
      checked?: boolean;
      run: () => unknown;
    }
  | { kind: "separator" }
  | { kind: "header"; label: string };

export interface MenuState {
  items: MenuItem[];
  anchor: Anchor;
  align: "start" | "end";
  minWidth: number;
  onClose?: () => void;
}

export const menu = $state<{ current: MenuState | null }>({ current: null });

export function openMenu(items: MenuItem[], anchor: Anchor, opts: { align?: "start" | "end"; minWidth?: number; onClose?: () => void } = {}): void {
  menu.current?.onClose?.();
  menu.current = { items, anchor, align: opts.align ?? "start", minWidth: opts.minWidth ?? 180, onClose: opts.onClose };
}

/** Sağ tık için: varsayılan tarayıcı menüsünü bastırıp imleç konumunda açar. */
export function openContextMenu(e: MouseEvent, items: MenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  openMenu(items, { x: e.clientX, y: e.clientY });
}

export function closeMenu(): void {
  const current = menu.current;
  menu.current = null;
  current?.onClose?.();
}
