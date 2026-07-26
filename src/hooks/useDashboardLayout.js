// ===================================================================
// src/hooks/useDashboardLayout.js — per-user dashboard layout.
//
// The layout belongs to the PERSON, not the business:
//   owner        → userProfiles.dashboardLayout   (one row per tenant)
//   team member  → memberProfiles.dashboardLayout (one row per member,
//                  created by MainApp on first login, keyed by doc.userId)
// Both are `doc jsonb`, so this needs no schema migration. Storing it in the
// DB rather than localStorage means the layout follows the person to a new
// browser or phone.
//
// A member with no saved layout gets a COPY of their role preset, not a live
// reference — so changing a preset later can never silently rearrange a
// dashboard someone has already made their own.
// ===================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { dbWrite, dbOp } from '../utils/dbWrite';
import { presetFor } from '../../api/_shared-dashboard-widgets';

const lsKey = (uid) => `tc_dash_layout_${uid || 'anon'}`;

function readCache(uid) {
  try {
    const raw = localStorage.getItem(lsKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * @param {object}  o
 * @param {string}  o.userId         the viewer's own id (cache key)
 * @param {boolean} o.isOwner
 * @param {string}  o.role
 * @param {object}  o.profile        userProfiles row (owner target)
 * @param {object}  o.memberProfile  memberProfiles row (member target)
 * @param {boolean} o.ready          source records have finished loading
 */
export function useDashboardLayout({ userId, isOwner, role, profile, memberProfile, ready }) {
  const [layout, setLayoutState] = useState(null);
  const [saveError, setSaveError] = useState(null);
  // Guards against the saved layout being clobbered by the preset: the DB
  // records arrive a tick after first render, so without this the effect would
  // seed a preset, then the record lands and we'd overwrite the user's real
  // layout with it.
  const seeded = useRef(false);

  const target = isOwner
    ? { collection: 'userProfiles', id: profile?.id }
    : { collection: 'memberProfiles', id: memberProfile?.id };

  useEffect(() => {
    if (!ready || seeded.current) return;
    const saved = (isOwner ? profile?.dashboardLayout : memberProfile?.dashboardLayout)
      || readCache(userId);
    setLayoutState(saved && (saved.tiles || saved.sections) ? saved : presetFor({ isOwner, role }));
    seeded.current = true;
  }, [ready, isOwner, role, profile, memberProfile, userId]);

  const persist = useCallback((next) => {
    setLayoutState(next);
    // Cache first: it is synchronous and always available, so a layout is never
    // lost even if the record isn't there yet or the write fails.
    try { localStorage.setItem(lsKey(userId), JSON.stringify(next)); } catch {}
    if (!target.id) return; // record not created yet — cache carries it until then
    dbWrite(dbOp.update(target.collection, target.id, { dashboardLayout: next }))
      .then(() => setSaveError(null))
      .catch((e) => setSaveError(e?.message || 'Could not save layout'));
  }, [target.collection, target.id, userId]);

  const addWidget = useCallback((id, kind) => {
    setLayoutState(cur => {
      const key = kind === 'tile' ? 'tiles' : 'sections';
      if ((cur?.[key] || []).includes(id)) return cur;
      const next = { ...cur, [key]: [...(cur?.[key] || []), id] };
      persist(next);
      return next;
    });
  }, [persist]);

  const removeWidget = useCallback((id, kind) => {
    setLayoutState(cur => {
      const key = kind === 'tile' ? 'tiles' : 'sections';
      const next = { ...cur, [key]: (cur?.[key] || []).filter(x => x !== id) };
      persist(next);
      return next;
    });
  }, [persist]);

  const moveWidget = useCallback((id, kind, delta) => {
    setLayoutState(cur => {
      const key = kind === 'tile' ? 'tiles' : 'sections';
      const list = [...(cur?.[key] || [])];
      const i = list.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return cur;
      [list[i], list[j]] = [list[j], list[i]];
      const next = { ...cur, [key]: list };
      persist(next);
      return next;
    });
  }, [persist]);

  /** Drag-and-drop reorder: move `id` to sit at `toIndex` within its list. */
  const reorderWidget = useCallback((id, kind, toIndex) => {
    setLayoutState(cur => {
      const key = kind === 'tile' ? 'tiles' : 'sections';
      const list = [...(cur?.[key] || [])];
      const from = list.indexOf(id);
      if (from < 0 || toIndex < 0 || toIndex >= list.length || from === toIndex) return cur;
      list.splice(from, 1);
      list.splice(toIndex, 0, id);
      const next = { ...cur, [key]: list };
      persist(next);
      return next;
    });
  }, [persist]);

  const resetLayout = useCallback(() => {
    persist(presetFor({ isOwner, role }));
  }, [persist, isOwner, role]);

  return { layout, addWidget, removeWidget, moveWidget, reorderWidget, resetLayout, saveError };
}
