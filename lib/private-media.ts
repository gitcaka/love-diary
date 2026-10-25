// Rebase migrated PHP photo URLs onto the authenticated origin. Never persist
// a session credential in a URL, backup, diary record or browser history.
export function privateMediaUrl(value: string, origin: string): string {
  try {
    const url = new URL(value, origin);
    if (!url.pathname.endsWith('/api.php') || url.searchParams.get('route') !== 'media-file') return value;
    const id = url.searchParams.get('id');
    if (!id || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) return value;
    const target = new URL('/api.php', origin);
    target.searchParams.set('route', 'media-file');
    target.searchParams.set('id', id);
    // Old public responses were immutable; do not reuse those cached URLs.
    target.searchParams.set('private', '1');
    return target.toString();
  } catch { return value; }
}

export function privateMediaState<T>(value: T, origin: string): T {
  const visit = (item: unknown, key = ''): unknown => {
    if (typeof item === 'string' && ['url', 'avatar1', 'avatar2', 'coverImage'].includes(key)) return privateMediaUrl(item, origin);
    if (Array.isArray(item)) return item.map((child) => visit(child));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, visit(child, name)]));
    return item;
  };
  return visit(value) as T;
}

// Presentation only: do not persist thumbnail URLs in diary records.
export function privateImageVariant(value: string, variant: "thumb" | "display" | "original"): string {
  try {
    const url = new URL(value, "https://local.invalid");
    if (!url.pathname.endsWith('/api.php') || url.searchParams.get('route') !== 'media-file'
      || !/^[a-zA-Z0-9-]{1,100}$/.test(url.searchParams.get('id') || '')) return value;
    url.searchParams.set('variant', variant);
    return /^https?:\/\//.test(value) ? url.toString() : url.pathname + url.search + url.hash;
  } catch { return value; }
}
