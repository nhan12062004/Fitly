export type ResourceState<T> = {
  data: T | null;
  error: Error | null;
  fetching: boolean;
  updatedAt: number;
};

let activeAccount: string | null = null;
const resetters = new Set<() => void>();

/** Personal read data stays in memory and is discarded when the account changes. */
export function activateReadAccount(userId: string | null) {
  if (activeAccount === userId) return;
  activeAccount = userId;
  resetters.forEach((reset) => reset());
}

export function createAccountResource<T>(loader: (userId: string, signal: AbortSignal) => Promise<T>, maxAgeMs = 30_000) {
  type Entry = { state: ResourceState<T>; pending: Promise<T> | null; controller: AbortController | null; version: number };
  const empty: ResourceState<T> = { data: null, error: null, fetching: false, updatedAt: 0 };
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const entryFor = (userId: string) => {
    let entry = entries.get(userId);
    if (!entry) {
      entry = { state: empty, pending: null, controller: null, version: 0 };
      entries.set(userId, entry);
    }
    return entry;
  };
  const invalidate = (userId: string) => {
    const entry = entries.get(userId);
    if (!entry) return;
    entry.version += 1;
    entry.controller?.abort();
    entry.pending = null;
    entry.controller = null;
    entry.state = { ...entry.state, fetching: false, updatedAt: 0 };
    emit();
  };
  resetters.add(() => {
    entries.forEach((entry) => { entry.version += 1; entry.controller?.abort(); });
    entries.clear();
    emit();
  });

  return {
    read(userId: string | null | undefined): ResourceState<T> {
      return userId && userId === activeAccount ? entries.get(userId)?.state || empty : empty;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidate,
    publish(userId: string, data: T) {
      if (userId !== activeAccount) return;
      invalidate(userId);
      entryFor(userId).state = { data, error: null, fetching: false, updatedAt: Date.now() };
      emit();
    },
    load(userId: string, force = false): Promise<T> {
      if (userId !== activeAccount) return Promise.reject(new Error('Tài khoản đã thay đổi.'));
      const entry = entryFor(userId);
      if (entry.pending) return entry.pending;
      if (!force && entry.state.data !== null && Date.now() - entry.state.updatedAt < maxAgeMs) return Promise.resolve(entry.state.data);
      const controller = new AbortController();
      const version = ++entry.version;
      entry.controller = controller;
      entry.state = { ...entry.state, error: null, fetching: true };
      const valid = () => userId === activeAccount && entries.get(userId) === entry && entry.version === version;
      const pending = Promise.resolve().then(() => loader(userId, controller.signal)).then((data) => {
        if (!valid()) throw new DOMException('Cancelled', 'AbortError');
        entry.state = { data, error: null, fetching: false, updatedAt: Date.now() };
        return data;
      }).catch((error: unknown) => {
        if (valid()) entry.state = { ...entry.state, error: error instanceof Error ? error : new Error('Chưa tải được dữ liệu.'), fetching: false };
        throw error;
      }).finally(() => {
        if (valid()) { entry.pending = null; entry.controller = null; emit(); }
      });
      entry.pending = pending;
      emit();
      return pending;
    },
  };
}
