// ── Safe localStorage helpers ──
// localStorage can throw in private browsing mode, when quota is exceeded,
// or when the storage is otherwise unavailable. These wrappers prevent crashes.

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    console.warn(`localStorage.getItem('${key}') failed — storage may be unavailable`);
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    console.warn(`localStorage.setItem('${key}') failed — storage may be full or unavailable`);
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    console.warn(`localStorage.removeItem('${key}') failed`);
  }
}
