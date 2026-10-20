// Çeviri: Türkçe kaynak sözlüktür; İngilizce aynı anahtarları taşımak zorundadır (Shape<…>).
// Her özellik kendi isim alanı dosyasına yazar: tr/<ns>.ts + en/<ns>.ts.
import type { Dict, Leaves, Msg } from "./types";
import trBrowser from "./tr/browser";
import trBulk from "./tr/bulk";
import trCommon from "./tr/common";
import trConnections from "./tr/connections";
import trConsole from "./tr/console";
import trEditors from "./tr/editors";
import trOnboarding from "./tr/onboarding";
import trServer from "./tr/server";
import trSettings from "./tr/settings";
import trShell from "./tr/shell";
import enBrowser from "./en/browser";
import enBulk from "./en/bulk";
import enCommon from "./en/common";
import enConnections from "./en/connections";
import enConsole from "./en/console";
import enEditors from "./en/editors";
import enOnboarding from "./en/onboarding";
import enServer from "./en/server";
import enSettings from "./en/settings";
import enShell from "./en/shell";

const tr = {
  common: trCommon,
  shell: trShell,
  connections: trConnections,
  browser: trBrowser,
  editors: trEditors,
  console: trConsole,
  server: trServer,
  bulk: trBulk,
  onboarding: trOnboarding,
  settings: trSettings,
};

const en = {
  common: enCommon,
  shell: enShell,
  connections: enConnections,
  browser: enBrowser,
  editors: enEditors,
  console: enConsole,
  server: enServer,
  bulk: enBulk,
  onboarding: enOnboarding,
  settings: enSettings,
};

export type Locale = "tr" | "en";
export type TKey = Leaves<typeof tr>;
export type TParams = Record<string, string | number | boolean | null | undefined>;

const dictionaries: Record<Locale, Dict> = { tr, en };

let current = $state<Locale>(detectLocale());

export function detectLocale(): Locale {
  const lang = typeof navigator === "undefined" ? "tr" : navigator.language.toLowerCase();
  return lang.startsWith("tr") ? "tr" : "en";
}

export const i18n = {
  get locale(): Locale {
    return current;
  },
  set locale(value: Locale) {
    current = value;
    if (typeof document !== "undefined") document.documentElement.lang = value;
  },
};

let numberFormat = new Intl.NumberFormat("tr-TR");
let numberLocale: Locale = "tr";

/** Sayıyı etkin dile göre biçimlendirir (TR: 1.234, EN: 1,234). */
export function fmtNumber(value: number): string {
  if (numberLocale !== current) {
    numberFormat = new Intl.NumberFormat(current === "tr" ? "tr-TR" : "en-US");
    numberLocale = current;
  }
  return numberFormat.format(value);
}

function lookup(dict: Dict, key: string): Msg | undefined {
  let node: Msg | Dict | undefined = dict;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node !== "object") return undefined;
    node = (node as Dict)[part];
  }
  return typeof node === "string" || typeof node === "function" ? node : undefined;
}

export function t(key: TKey, params?: TParams): string {
  const msg = lookup(dictionaries[current], key) ?? lookup(dictionaries.tr, key);
  if (msg === undefined) {
    if (import.meta.env.DEV) console.warn(`i18n: eksik anahtar ${key}`);
    return key;
  }
  const template = typeof msg === "function" ? msg(params ?? {}) : msg;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) return whole;
    return typeof value === "number" ? fmtNumber(value) : String(value);
  });
}
