// Uygulama genelindeki pencere/diyalog anahtarları ve kalıcı yerleşim ölçüleri.
import { api } from "$lib/api";
import type { ConnectionConfig } from "$lib/api/types";

export const ui = $state({
  settingsOpen: false,
  /** null = kapalı; boş id = yeni bağlantı */
  connectionEditor: null as ConnectionConfig | null,
  /** ARDM / dosyadan içe aktarma sihirbazı */
  importOpen: false,
  jobsOpen: false,
  shortcutsOpen: false,
});

export interface Layout {
  railWidth: number;
  railCollapsed: boolean;
  browserWidth: number;
}

export const LAYOUT_DEFAULTS: Layout = { railWidth: 232, railCollapsed: false, browserWidth: 380 };

export const layout = $state<Layout>({ ...LAYOUT_DEFAULTS });

let loaded = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function loadLayout(): Promise<void> {
  const stored = await api.app.storeGet<Partial<Layout>>("layout").catch(() => null);
  Object.assign(layout, LAYOUT_DEFAULTS, stored ?? {});
  loaded = true;
}

export function trackLayout(): void {
  $effect(() => {
    const snapshot = $state.snapshot(layout);
    if (!loaded) return;
    clearTimeout(timer);
    timer = setTimeout(() => void api.app.storeSet("layout", snapshot), 500);
  });
}
