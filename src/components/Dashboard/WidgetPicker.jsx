import React, { useMemo } from 'react';
import { WIDGETS, isWidgetAllowed } from '../../../api/_shared-dashboard-widgets';

// The "Add widget" catalogue, shown while the dashboard is in edit mode.
//
// Widgets the viewer isn't entitled to are rendered LOCKED rather than hidden.
// Hiding them makes the catalogue look arbitrary ("why does Bhavya have a
// revenue tile and I don't?"); showing them greyed explains the gap and gives
// the owner an obvious place to grant access. The lock is cosmetic — the real
// enforcement is in the widget endpoint, which refuses to compute anything the
// caller can't see even if they hand-edit their saved layout.
export default function WidgetPicker({ layout, ctx, onAdd, onReset, onClose }) {
  const groups = useMemo(() => {
    const out = new Map();
    for (const [id, w] of Object.entries(WIDGETS)) {
      if (!out.has(w.group)) out.set(w.group, []);
      out.get(w.group).push({ id, ...w, allowed: isWidgetAllowed(id, ctx) });
    }
    // Groups where the viewer can't use a single widget are noise — drop them.
    return [...out.entries()].filter(([, items]) => items.some(i => i.allowed));
  }, [ctx]);

  const active = useMemo(() => new Set([...(layout?.tiles || []), ...(layout?.sections || [])]), [layout]);

  return (
    <div className="tw" style={{ marginBottom: 18 }}>
      <div className="tw-head">
        <h3>Add widget</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={onReset}>Reset to default</button>
          <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
      <div style={{ padding: '12px 16px 16px' }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
          Your layout only — nobody else's dashboard changes.
        </div>
        {groups.map(([group, items]) => (
          <div key={group} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>{group}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {items.map(w => {
                const on = active.has(w.id);
                if (!w.allowed) {
                  return (
                    <span
                      key={w.id}
                      title="Not available with your role or plan"
                      style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--muted)', opacity: 0.65 }}
                    >
                      🔒 {w.label}
                    </span>
                  );
                }
                return (
                  <button
                    key={w.id}
                    onClick={() => !on && onAdd(w.id, w.kind)}
                    disabled={on}
                    title={on ? 'Already on your dashboard' : `Add ${w.label}`}
                    style={{
                      fontSize: 11, padding: '6px 10px', borderRadius: 6, cursor: on ? 'default' : 'pointer',
                      border: '1px solid ' + (on ? 'var(--border)' : 'var(--accent)'),
                      background: on ? 'var(--bg)' : 'transparent',
                      color: on ? 'var(--muted)' : 'var(--accent)',
                      fontWeight: 600,
                    }}
                  >
                    {on ? '✓ ' : '+ '}{w.label}
                    {w.kind === 'section' && <span style={{ opacity: 0.6, fontWeight: 400 }}> · section</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
