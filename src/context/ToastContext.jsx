import React, { createContext, useContext, useState, useCallback } from 'react';
import { uid } from '../utils/helpers';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Persistent toasts (notifications) queue here — only persistentQueue[0] is
  // ever rendered/visible. Several arriving at once (e.g. multiple leads
  // becoming due-soon in the same poll) no longer stack on top of each other;
  // they show one at a time, advancing to the next only when the current one
  // is closed.
  const [persistentQueue, setPersistentQueue] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const dismissCurrentPersistent = useCallback(() => {
    setPersistentQueue(prev => prev.slice(1));
  }, []);

  // Third arg { persistent: true } skips the auto-dismiss timer, shows a
  // manual close button, and queues behind any other persistent toast
  // currently showing — for alerts the user must not miss (e.g. follow-up
  // due-soon notifications). Every other toast() call keeps the existing
  // quick auto-dismiss, freely-stacking behavior unchanged.
  const toast = useCallback((msg, type = 'success', opts = {}) => {
    const id = uid();
    if (opts.persistent) {
      setPersistentQueue(prev => [...prev, { id, msg, type }]);
      return;
    }
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const current = persistentQueue[0];

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="tc">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : t.type === 'warning' ? '⚠' : 'ℹ'}</span>
            <span style={{ flex: 1 }}>{t.msg}</span>
          </div>
        ))}
        {current && (
          <div key={current.id} className={`toast ${current.type}`}>
            <span>{current.type === 'success' ? '✓' : current.type === 'error' ? '✕' : current.type === 'warning' ? '⚠' : 'ℹ'}</span>
            <span style={{ flex: 1 }}>{current.msg}</span>
            <span
              onClick={dismissCurrentPersistent}
              style={{ cursor: 'pointer', fontWeight: 700, opacity: 0.8, paddingLeft: 4 }}
            >✕</span>
            {persistentQueue.length > 1 && (
              <span style={{ fontSize: 10, opacity: 0.75, marginLeft: 6 }}>+{persistentQueue.length - 1} more</span>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
