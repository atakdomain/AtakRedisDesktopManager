// Bağlantı rayının kalıcı küçük tercihleri: son kullanılanlar ve kapalı gruplar.
import { api } from "$lib/api";

const DOC = "connectionPrefs";
const RECENT_LIMIT = 20;

interface Stored {
  recent: string[];
  collapsedGroups: string[];
}

export const prefs = $state<Stored & { loaded: boolean }>({ recent: [], collapsedGroups: [], loaded: false });

let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function loadPrefs(): Promise<void> {
  loading ??= api.app
    .storeGet<Partial<Stored>>(DOC)
    .catch(() => null)
    .then((stored) => {
      // Yükleme sürerken yapılan değişiklikler kaybolmasın
      prefs.recent = [...new Set([...prefs.recent, ...(stored?.recent ?? [])])].slice(0, RECENT_LIMIT);
      prefs.collapsedGroups = [...new Set([...prefs.collapsedGroups, ...(stored?.collapsedGroups ?? [])])];
      prefs.loaded = true;
    });
  return loading;
}

function persist(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void api.app.storeSet(DOC, { recent: prefs.recent, collapsedGroups: prefs.collapsedGroups } satisfies Stored).catch(() => undefined);
  }, 300);
}

export function touchRecent(id: string): void {
  if (prefs.recent[0] === id) return;
  prefs.recent = [id, ...prefs.recent.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
  persist();
}

export function isGroupCollapsed(name: string): boolean {
  return prefs.collapsedGroups.includes(name);
}

export function toggleGroup(name: string, collapsed = !isGroupCollapsed(name)): void {
  if (collapsed === isGroupCollapsed(name)) return;
  prefs.collapsedGroups = collapsed ? [...prefs.collapsedGroups, name] : prefs.collapsedGroups.filter((g) => g !== name);
  persist();
}
