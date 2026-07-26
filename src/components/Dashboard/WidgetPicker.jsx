import React, { useMemo } from 'react';
import { WIDGETS, isWidgetAllowed } from '../../../api/_shared-dashboard-widgets';

// The "Add widget" catalogue, shown while the dashboard is in edit mode.
//
// Numbers and panels are split into their own labelled rows and drawn
// differently. They used to sit in one flat list separated only by a small
// grey "· section" suffix, which meant you couldn't tell whether you were
// adding a single figure or a whole scrolling table until you'd added it.
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
      if (!out.has(w.group)) out.set(w.group, { tile: [], section: [] });
      out.get(w.group)[w.kind].push({ id, ...w, allowed: isWidgetAllowed(id, ctx) });
    }
    // Groups where the viewer can't use a single widget are noise — drop them.
    return [...out.entries()].filter(([, g]) => [...g.tile, ...g.section].some(i => i.allowed));
  }, [ctx]);

  const active = useMemo(
    () => new Set([...(layout?.tiles || []), ...(layout?.sections || [])]),
    [layout]
  );

  const Chip = ({ w }) => {
    const on = active.has(w.id);
    const isTile = w.kind === 'tile';
    const base = {
      textAlign: 'left', borderRadius: 8, padding: isTile ? '7px 11px' : '9px 12px',
      display: 'flex', flexDirection: 'column', gap: 2,
      width: isTile ? 'auto' : 230, minWidth: isTile ? 118 : 230,
    };
    if (!w.allowed) {
      return (
        <span title="Not available with your role or plan"
          style={{ ...base, border: '1px dashed var(--border)', background: 'var(--bg)', color: 'var(--muted)', opacity: 0.7 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600 }}>🔒 {w.label}</span>
          {!isTile && <span style={{ fontSize: 10.5, lineHeight: 1.4 }}>{w.desc}</span>}
        </span>
      );
    }
    return (
      <button
        onClick={() => !on && onAdd(w.id, w.kind)}
        disabled={on}
        title={on ? 'Already on your dashboard' : w.desc}
        style={{
          ...base,
          cursor: on ? 'default' : 'pointer',
          border: '1px solid ' + (on ? 'var(--border)' : 'var(--accent)'),
          background: on ? 'var(--bg)' : 'transparent',
          color: on ? 'var(--muted)' : 'var(--accent)',
        }}
      >
        <span style={{ fontSize: 11.5, fontWeight: 700 }}>{on ? '✓ ' : '+ '}{w.label}</span>
        <span style={{ fontSize: 10.5, lineHeight: 1.4, color: on ? 'var(--muted)' : 'var(--text)', opacity: on ? 1 : 0.75, fontWeight: 400 }}>
          {w.desc}
        </span>
      </button>
    );
  };

  const Row = ({ title, hint, items }) => items.length === 0 ? null : (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text)' }}>{title}</span>
        <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{hint}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {items.map(w => <Chip key={w.id} w={w} />)}
      </div>
    </div>
  );

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
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
          Your layout only — nobody else's dashboard changes. Drag widgets to reorder them.
        </div>
        {groups.map(([group, g], gi) => (
          <div key={group} style={{ marginBottom: 18, paddingTop: gi === 0 ? 0 : 14, borderTop: gi === 0 ? 'none' : '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{group}</div>
            <Row title="Numbers" hint="one figure, click it to open the full list" items={g.tile} />
            <Row title="Panels" hint="a list, table or chart" items={g.section} />
          </div>
        ))}
      </div>
    </div>
  );
}
