import type { User } from '../data/mockDb';

type SessionUser = Pick<User, 'id' | 'staffId'>;
type ActivityStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function activityKey(user: SessionUser) {
  return `connexy_activity:${encodeURIComponent(user.id)}:${encodeURIComponent(user.staffId || '')}`;
}
export function isSessionLocked(user: SessionUser, storage: ActivityStorage = sessionStorage) {
  try { return storage.getItem(`${activityKey(user)}:locked`) === '1'; } catch { return true; }
}
export function markSessionActive(user: SessionUser, storage: ActivityStorage = sessionStorage, now = Date.now()) {
  storage.setItem(activityKey(user), String(now));
  storage.removeItem(`${activityKey(user)}:locked`);
}

interface MonitorOptions {
  user: SessionUser;
  onExpire: () => void;
  onRevalidate: () => void;
  storage?: ActivityStorage;
  events?: EventTarget;
  visibilityEvents?: EventTarget;
  now?: () => number;
  schedule?: (callback: () => void, milliseconds: number) => number;
  cancel?: (id: number) => void;
}

// 無操作ロックはタブ内の画面保護。認可はDB側の8時間上限で担保する。
export function startSessionMonitor(options: MonitorOptions) {
  const { user, onExpire, onRevalidate, storage = sessionStorage, events = window,
    visibilityEvents = document, now = Date.now,
    schedule = window.setInterval.bind(window), cancel = window.clearInterval.bind(window) } = options;
  const key = activityKey(user);
  let expired = false;
  let lastRevalidated = now();
  let lastWritten = 0;
  const expire = () => {
    if (expired) return;
    expired = true;
    try { storage.setItem(`${key}:locked`, '1'); } catch { /* 画面は閉じる */ }
    onExpire();
  };
  const check = () => {
    if (expired) return false;
    try {
      const raw = storage.getItem(key);
      const time = now();
      if (isSessionLocked(user, storage)) { expire(); return false; }
      if (raw === null) { storage.setItem(key, String(time)); return true; }
      const lastActivity = Number(raw);
      if (!Number.isFinite(lastActivity) || lastActivity > time || time - lastActivity >= IDLE_TIMEOUT_MS) {
        expire(); return false;
      }
      return true;
    } catch { expire(); return false; }
  };
  const activity = () => {
    if (!check()) return;
    const time = now();
    if (time - lastWritten < 1000) return;
    try { storage.setItem(key, String(time)); lastWritten = time; } catch { expire(); }
  };
  const tick = () => {
    if (!check()) return;
    if (now() - lastRevalidated >= 60_000) { lastRevalidated = now(); onRevalidate(); }
  };
  const inputs = ['pointerdown', 'keydown', 'touchstart'];
  inputs.forEach(event => events.addEventListener(event, activity));
  events.addEventListener('focus', tick);
  events.addEventListener('storage', tick);
  visibilityEvents.addEventListener('visibilitychange', tick);
  check();
  const timer = schedule(tick, 10_000);
  return () => {
    expired = true;
    cancel(timer);
    inputs.forEach(event => events.removeEventListener(event, activity));
    events.removeEventListener('focus', tick);
    events.removeEventListener('storage', tick);
    visibilityEvents.removeEventListener('visibilitychange', tick);
  };
}
