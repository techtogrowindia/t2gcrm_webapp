import React, { useMemo, useState, useRef, useEffect } from 'react';
import { WIDGETS, isWidgetAllowed } from '../../../api/_shared-dashboard-widgets';

// Compact widget chooser: one small button that opens a multi-select dropdown.
//
// This was previously a flat wall of chips — every widget in every group, always
// on screen, pushing the actual dashboard below the fold while editing. The
// catalogue is reference material, not something you stare at, so it collapses.
//
// Ticking adds, unticking removes: the dropdown is the single place to manage
// what's on the dashboard, rather than "add here, remove over there".
//
// NOT wrapped in .tw — that class sets `overflow: hidden`, which would clip the
// absolutely positioned menu.
//
// Widgets the viewer isn't entitled to stay listed but locked. Hiding them makes
// the catalogue look arbitrary ("why does Bhavya have a revenue tile?"); showing
// them explains the gap and gives the owner somewhere to grant access from. The
// lock is cosmetic — the widget endpoint refuses to compute anything the caller
// can't see, even if they hand-edit their saved layout.
export default function WidgetPicker({ layout, ctx, onAdd, onRemove, onReset, onClose }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const active = useMemo(
    () => new Set([...(layout?.tiles || []), ...(layout?.sections || [])]),
    [layout]
  );

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map();
    for (const [id, w] of Object.entries(WIDGETS)) {
      if (needle && !(`${w.label} ${w.desc}`.toLowerCase().includes(needle))) continue;
      if (!out.has(w.group)) out.set(w.group, { tile: [], section: [] });
      out.get(w.group)[w.kind].push({ id, ...w, allowed: isWidgetAllowed(id, ctx) });
    }
    // Groups with nothing the viewer can use are noise.
    return [...out.entries()].filter(([, g]) => [...g.tile, ...g.section].some(i => i.allowed));
  }, [ctx, q]);

  const allowedCount = useMemo(
    () => Object.keys(WIDGETS).filter(id => isWidgetAllowed(id, ctx)).length, [ctx]
  );

  const Row = ({ w }) => {
    const on = active.has(w.id);
    return (
      <label
        title={w.allowed ? w.desc : 'Not available with your role or plan'}
        style={{
          display: 'flex', gap: 9, alignItems: 'flex-start', padding: '6px 12px',
          cursor: w.allowed ? 'pointer' : 'default', opacity: w.allowed ? 1 : 0.5,
        }}
        onMouseEnter={e => { if (w.allowed) e.currentTarget.style.background = 'var(--bg)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <input
          type="checkbox"
          checked={on}
          disabled={!w.allowed}
          onChange={() => (on ? onRemove(w.id, w.kind) : onAdd(w.id, w.kind))}
          style={{ marginTop: 3, flexShrink: 0 }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{!w.allowed && '🔒 '}{w.label}</span>
          <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.35 }}>{w.desc}</span>
        </span>
      </label>
    );
  };

  const SubHead = ({ children }) => (
    <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--muted)', padding: '5px 12px 2px' }}>
      {children}
    </div>
  );

  return (
    <div ref={wrapRef} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16, position: 'relative', zIndex: 30 }}>
      <div style={{ position: 'relative' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(o => !o)}>
          ⊞ Widgets ({active.size}/{allowedCount}) ▾
        </button>

        {open && (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: 330,
              maxHeight: 420, overflowY: 'auto', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 10,
              boxShadow: '0 10px 28px rgba(0,0,0,.14)', zIndex: 60, paddingBottom: 6,
            }}
          >
            <div style={{ position: 'sticky', top: 0, background: 'var(--surface)', padding: '10px 12px 8px', borderBottom: '1px solid var(--border)', zIndex: 1 }}>
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search widgets…"
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 9px' }}
              />
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                Tick to add, untick to remove. Your layout only.
              </div>
            </div>

            {groups.length === 0 && (
              <div style={{ padding: '18px 12px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                No widgets match “{q}”
              </div>
            )}

            {groups.map(([group, g]) => (
              <div key={group} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, padding: '9px 12px 3px' }}>{group}</div>
                {g.tile.length > 0 && <SubHead>Numbers · single figure</SubHead>}
                {g.tile.map(w => <Row key={w.id} w={w} />)}
                {g.section.length > 0 && <SubHead>Panels · list, table or chart</SubHead>}
                {g.section.map(w => <Row key={w.id} w={w} />)}
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-secondary btn-sm" onClick={onReset}>Reset to default</button>
      <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Drag a widget to reorder · ⇤⇥ sets panel width</span>
    </div>
  );
}
