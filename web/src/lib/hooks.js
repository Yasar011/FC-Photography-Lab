import { useEffect, useState, useRef, useCallback } from 'react';
import { ref, onValue, query as q } from 'firebase/database';
import { db } from '../firebase.js';

/**
 * Subscribe to a database path or query in real time.
 * `source` is a path string, a Query, or null (skip). `deps` re-subscribes.
 */
export function useLive(source, deps = []) {
  const [state, setState] = useState({ value: undefined, loading: Boolean(source), error: null });
  useEffect(() => {
    if (!source) {
      setState({ value: null, loading: false, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    const target = typeof source === 'string' ? ref(db, source) : source;
    return onValue(
      target,
      (snap) => setState({ value: snap.val(), loading: false, error: null }),
      (error) => setState({ value: null, loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Like useLive but returns an array of { id, ...value } in database order. */
export function useLiveList(source, deps = []) {
  const [state, setState] = useState({ items: [], loading: Boolean(source), error: null });
  useEffect(() => {
    if (!source) {
      setState({ items: [], loading: false, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    const target = typeof source === 'string' ? ref(db, source) : source;
    return onValue(
      target,
      (snap) => {
        const items = [];
        snap.forEach((c) => {
          items.push({ id: c.key, ...c.val() });
        });
        setState({ items, loading: false, error: null });
      },
      (error) => setState({ items: [], loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export const dbRef = (path) => ref(db, path);
export const dbQuery = (path, ...constraints) => q(ref(db, path), ...constraints);

/** Run an async action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (err) {
      if (mounted.current) setError(err.message || String(err));
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

/** Re-render every `ms` so time-based UI (past slots, countdowns) stays current. */
export function useNow(ms = 60000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
