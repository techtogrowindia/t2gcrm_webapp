import { useEffect, useRef } from 'react';

const LAST_ACTIVITY_KEY = 't2g_last_activity';
const CHECK_INTERVAL_MS = 30 * 1000;      // how often to check while the tab is open
const WRITE_THROTTLE_MS = 5 * 1000;       // don't hammer localStorage on every mousemove
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];

/**
 * Logs the user out after `timeoutMs` of no interaction, anywhere in the app.
 *
 * Activity is stamped to a SHARED localStorage key, so idle time is tracked
 * across all tabs of the same browser — moving the mouse in one tab resets
 * the timer for all of them (the expected behavior for an idle-session
 * timeout, not a per-tab one). Checked on an interval AND on tab-visibility
 * change (catches a backgrounded tab whose timers were throttled by the
 * browser — otherwise a long time in the background wouldn't be noticed
 * until the next interval tick after the tab regains focus).
 *
 * @param {boolean} enabled - only track/check while a session is active.
 * @param {number} timeoutMs - idle duration before logout (e.g. 2 hours).
 * @param {() => void} onIdle - called once when the timeout is exceeded.
 */
export function useIdleLogout(enabled, timeoutMs, onIdle) {
  const loggedOutRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    loggedOutRef.current = false;

    // First run on a browser that's never tracked activity — don't treat a
    // fresh login as already idle.
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    }

    let lastWrite = 0;
    const stamp = () => {
      const now = Date.now();
      if (now - lastWrite < WRITE_THROTTLE_MS) return;
      lastWrite = now;
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    };

    const checkIdle = () => {
      if (loggedOutRef.current) return;
      const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now();
      if (Date.now() - last >= timeoutMs) {
        loggedOutRef.current = true;
        onIdle();
      }
    };

    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, stamp, { passive: true }));
    const interval = setInterval(checkIdle, CHECK_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') checkIdle(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, stamp));
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timeoutMs]);
}
