let counter = 0;

/** Oturum içi benzersiz kimlik (tarama, iş, abonelik). */
export function uid(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
