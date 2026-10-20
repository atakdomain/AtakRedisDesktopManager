// Base64 (standart ve URL-güvenli). Çözerken biçim (alfabe, dolgu) hatırlanır; geri yazarken aynısı kullanılır.

export interface Base64Style {
  url: boolean;
  pad: boolean;
}

export function encodeBase64(bytes: Uint8Array, style: Base64Style = { url: false, pad: true }): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  let out = btoa(raw);
  if (style.url) out = out.replace(/\+/g, "-").replace(/\//g, "_");
  if (!style.pad) out = out.replace(/=+$/, "");
  return out;
}

/** Geçersizse null. Boşluklar yok sayılır. */
export function decodeBase64(text: string): { bytes: Uint8Array; style: Base64Style } | null {
  const compact = text.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/\-_]*={0,2}$/.test(compact)) return null;
  const hasStd = /[+/]/.test(compact);
  const url = /[-_]/.test(compact);
  if (hasStd && url) return null;
  const body = compact.replace(/=+$/, "");
  if (body.length % 4 === 1) return null;
  const padded = compact.endsWith("=");
  if (padded && compact.length % 4 !== 0) return null;
  const standard = (url ? body.replace(/-/g, "+").replace(/_/g, "/") : body) + "=".repeat((4 - (body.length % 4)) % 4);
  let raw: string;
  try {
    raw = atob(standard);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { bytes, style: { url, pad: padded || body.length % 4 === 0 } };
}
