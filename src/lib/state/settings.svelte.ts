import { api } from "$lib/api";
import type { SearchMode } from "$lib/api/types";
import { detectLocale, i18n, type Locale } from "$lib/i18n/index.svelte";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  theme: Theme;
  locale: Locale;
  /** Arayüz yazı boyutu (px); 12–16 */
  fontSize: number;
  /** Bir "yükle" adımında en fazla kaç anahtar */
  scanLimit: number;
  /** Yeni aramalarda büyük/küçük harf duyarlılığı */
  caseSensitive: boolean;
  searchMode: SearchMode;
  treeView: boolean;
  /** Anahtar listesinde tür/TTL rozetleri */
  showKeyMeta: boolean;
  /** Konsolda FLUSHALL gibi tehlikeli komutlar için onay */
  confirmDangerous: boolean;
  wordWrap: boolean;
  /** İlk açılış karşılaması (ARDM'den aktar) gösterildi mi */
  onboardingDone: boolean;
}

const defaults: Settings = {
  theme: "system",
  locale: detectLocale(),
  fontSize: 13,
  scanLimit: 10000,
  caseSensitive: false,
  searchMode: "contains",
  treeView: true,
  showKeyMeta: true,
  confirmDangerous: true,
  wordWrap: true,
  onboardingDone: false,
};

export const settings = $state<Settings>({ ...defaults });

let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export async function loadSettings(): Promise<void> {
  const stored = await api.app.storeGet<Partial<Settings>>("settings").catch(() => null);
  Object.assign(settings, defaults, stored ?? {});
  loaded = true;
  applySettings();
}

const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function resolvedTheme(): "light" | "dark" {
  if (settings.theme !== "system") return settings.theme;
  return darkQuery?.matches ? "dark" : "light";
}

function applySettings(): void {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme();
  root.style.fontSize = `${settings.fontSize}px`;
  root.style.setProperty("--fs", `${settings.fontSize}px`);
  i18n.locale = settings.locale;
}

darkQuery?.addEventListener("change", () => {
  if (settings.theme === "system") applySettings();
});

/** Ayar değiştikçe uygular ve 400 ms sonra diske yazar. App.svelte'de bir kez çağrılır. */
export function trackSettings(): void {
  $effect(() => {
    const snapshot = $state.snapshot(settings);
    if (!loaded) return;
    applySettings();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void api.app.storeSet("settings", snapshot), 400);
  });
}
