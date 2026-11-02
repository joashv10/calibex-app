'use client';
import { useCallback, useSyncExternalStore } from 'react';

// A reminder tap carries a URL like "/?open=morning" or "/food?add=lunch". On a cold
// start the page reads it from location.search; when the app is already open the
// service worker posts it here instead, and the page that owns that param picks it
// up (useOpenRequest). The nonce makes a second identical tap still count.
type Req = { path: string; key: string; value: string; nonce: number };
let current: Req | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

export function requestOpen(url: string) {
  const u = new URL(url, window.location.origin);
  const [key, value] = [...u.searchParams.entries()][0] ?? ['', ''];
  current = { path: u.pathname, key, value, nonce: ++nonce };
  listeners.forEach((f) => f());
}

// The param `key` for this page: from a live reminder tap, else from the URL the
// app was opened with. Call consume() once handled so it can't fire twice.
export function useOpenRequest(path: string, key: string): { value: string | null; consume: () => void } {
  const req = useSyncExternalStore(
    (f) => { listeners.add(f); return () => { listeners.delete(f); }; },
    () => current,
    () => null,
  );
  let value: string | null = null;
  if (req && req.path === path && req.key === key) value = req.value;
  else if (typeof window !== 'undefined' && window.location.pathname === path) {
    value = new URLSearchParams(window.location.search).get(key);
  }
  const consume = useCallback(() => {
    if (current && current.path === path && current.key === key) current = null;
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(key)) {
      window.history.replaceState({}, '', path);
    }
  }, [path, key]);
  return { value, consume };
}
