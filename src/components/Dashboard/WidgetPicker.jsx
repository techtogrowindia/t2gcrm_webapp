import React, { useMemo, useState, useRef, useEffect } from 'react';
import { WIDGETS, isWidgetAllowed } from '../../../api/_shared-dashboard-widgets';

// Two separate choosers — one for counts, one for panels.
//
// They were previously one dropdown with sub-headings, and before that a flat
// wall of chips. Neither made the distinction land: a single figure and a
// scrolling table looked like the same kind of thing right up until you added
// one. Splitting them into two buttons makes the choice explicit before the
// menu even opens — you pick which KIND of widget you want first.
//
// NOT wrapped in .tw: that class sets `overflow: hidden`, which would clip the
// absolutely positioned menus.
//
// Widgets the viewer isn't entitled to stay listed but locked. Hiding them
// makes the catalogue look arbitrary ("why does Bhavya have a revenue tile?");
// showing them explains the gap and gives the owner somewhere to grant access
// from. The lock is cosmetic — the widget endpoint refuses to compute anything
// the caller can't see, even if they hand-edit their saved layout.

function KindDropdown({ kind, icon, title, blurb, ctx, active, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const all = useMemo(
    () => Object.entries(WIDGETS)
      .filter(([, w]) => w.kind === kind)
      .map(([id, w]) => ({ id, ...w, allowed: isWidgetAllowed(id, ctx) })),
    [kind, ctx]
  );
  const allowedCount = all.filter(w => w.allowed).length;
  const onCount = all.filter(w => active.has(w.id)).length;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map();
    for (const w of all) {
      if (needle && !`${w.label} ${w.desc}`.toLowerCase().includes(needle)) continue;
      if (!out.has(w.group)) out.set(w.group, []);
      out.get(w.group).push(w);
    }
    return [...out.entries()].filter(([, items]) => items.some(i => i.allowed));
  }, [all, q]);

  if (allowedCount === 0) return null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(o => !o)}>
        {icon} {title} ({onCount}/{allowedCount}) ▾
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
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{title}</div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 7 }}>{blurb}</div>
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search…"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 9px' }}
            />
          </div>

          {groups.length === 0 && (
            <div style={{ padding: '18px 12px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
              Nothing matches “{q}”
            </div>
          )}

          {groups.map(([group, items]) => (
            <div key={group} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--muted)', padding: '8px 12px 3px' }}>{group}</div>
              {items.map(w => {
                const on = active.has(w.id);
                return (
                  <label
                    key={w.id}
                    title={w.allowed ? w.desc : 'Not available with your role or plan'}
                    style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '6px 12px', cursor: w.allowed ? 'pointer' : 'default', opacity: w.allowed ? 1 : 0.5 }}
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
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WidgetPicker({ layout, ctx, onAdd, onRemove, onReset, onClose }) {
  const active = useMemo(
    () => new Set([...(layout?.tiles || []), ...(layout?.sections || [])]),
    [layout]
  );

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16, position: 'relative', zIndex: 30 }}>
      <KindDropdown
        kind="tile" icon="🔢" title="Counts"
        blurb="A single number. Click it to open the full list."
        ctx={ctx} active={active} onAdd={onAdd} onRemove={onRemove}
      />
      <KindDropdown
        kind="section" icon="▤" title="Panels"
        blurb="A list, table or chart with the detail in it."
        ctx={ctx} active={active} onAdd={onAdd} onRemove={onRemove}
      />
      <button className="btn btn-secondary btn-sm" onClick={onReset}>Reset to default</button>
      <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Tick to add, untick to remove · drag to reorder</span>
    </div>
  );
}
