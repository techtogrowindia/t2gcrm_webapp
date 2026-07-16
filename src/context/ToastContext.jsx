import React, { createContext, useContext, useState, useCallback } from 'react';
import { uid } from '../utils/helpers';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Third arg { persistent: true } skips the auto-dismiss timer and shows a
  // manual close button instead — for alerts the user must not miss (e.g.
  // follow-up due-soon notifications), while every other toast() call in the
  // app keeps its existing quick auto-dismiss behavior unchanged.
  const toast = useCallback((msg, type = 'success', opts = {}) => {
    const id = uid();
    const persistent = !!opts.persistent;
    setToasts(prev => [...prev, { id, msg, type, persistent }]);
    if (!persistent) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3500);
    }
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="tc">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : t.type === 'warning' ? '⚠' : 'ℹ'}</span>
            <span style={{ flex: 1 }}>{t.msg}</span>
            {t.persistent && (
              <span
                onClick={() => removeToast(t.id)}
                style={{ cursor: 'pointer', fontWeight: 700, opacity: 0.8, paddingLeft: 4 }}
              >✕</span>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
