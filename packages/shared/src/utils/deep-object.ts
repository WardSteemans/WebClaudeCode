// ── Deep object utilities ──
// Used by both backend (Claude settings merge) and frontend (settings store)

/**
 * Deep-merge `source` into `target`.
 * - Nested objects are merged recursively.
 * - `null` values in source delete the corresponding key from the result.
 * - Arrays are replaced, not merged.
 */
export function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === null) {
      delete result[key];
    } else if (typeof value === 'object' && !Array.isArray(value) && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Get a nested value from an object by dot-separated path */
export function deepGet(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Set a nested value on an object by dot-separated path (returns a new object) */
export function deepSet(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.');
  const result = { ...obj };
  let current: Record<string, unknown> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current) || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    } else {
      current[keys[i]] = { ...(current[keys[i]] as Record<string, unknown>) };
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

/** Delete a nested key from an object by dot-separated path (returns a new object) */
export function deepDelete(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const keys = path.split('.');
  if (keys.length === 1) {
    const { [keys[0]]: _, ...rest } = obj;
    return rest;
  }
  const parent = deepGet(obj, keys.slice(0, -1).join('.'));
  if (!parent || typeof parent !== 'object') return obj;
  const result = deepSet(obj, keys.slice(0, -1).join('.'), { ...(parent as Record<string, unknown>) });
  const lastKey = keys[keys.length - 1];
  const parentClone = deepGet(result, keys.slice(0, -1).join('.'));
  if (parentClone && typeof parentClone === 'object') {
    delete (parentClone as Record<string, unknown>)[lastKey];
  }
  return result;
}
