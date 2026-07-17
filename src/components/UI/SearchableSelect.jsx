import React, { useState, useRef, useEffect, useMemo } from 'react';

// searchKeys: extra object keys whose values also count as a match (e.g.
//   ['phone'] so a client can be found by phone number, not just name).
// subKey: an object key whose value is shown as a small secondary line under
//   each option (falls back to code/sku) — lets same-named records be told
//   apart at a glance (e.g. the phone number).
export default function SearchableSelect({ options, value, onChange, placeholder = "Select...", displayKey = "name", returnKey = "name", disabled = false, searchKeys = [], subKey = null }) {
  const searchKeysSig = searchKeys.join(',');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef(null);
  const dropdownRef = useRef(null);

  // Derive the display text for the current value
  const displayText = useMemo(() => {
    if (!value) return '';
    const selectedOption = options.find(opt => typeof opt === 'object' ? opt[returnKey] === value : opt === value);
    return selectedOption ? (typeof selectedOption === 'object' ? selectedOption[displayKey] : selectedOption) : value;
  }, [value, options, displayKey, returnKey]);

  // Handle outside clicks
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  // Position dropdown above if near bottom of viewport
  const [dropUp, setDropUp] = useState(false);
  useEffect(() => {
    if (isOpen && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < 280);
    }
  }, [isOpen]);

  // Filter options based on search
  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const s = search.toLowerCase();
    return options.filter(opt => {
      if (typeof opt !== 'object') return String(opt).toLowerCase().includes(s);
      const text = String(opt[displayKey] || '').toLowerCase();
      const code = String(opt.code || '').toLowerCase();
      const extra = String(opt.sku || '').toLowerCase();
      const extraKeys = searchKeys.some(k => String(opt[k] || '').toLowerCase().includes(s));
      return text.includes(s) || code.includes(s) || extra.includes(s) || extraKeys;
    });
  }, [options, search, displayKey, searchKeysSig]);

  const handleSelect = (opt) => {
    const val = typeof opt === 'object' ? opt[returnKey] : opt;
    onChange(val);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <style>{`
        .ss-dropdown-list::-webkit-scrollbar { width: 14px !important; display: block !important; }
        .ss-dropdown-list::-webkit-scrollbar-track { background: #f8fafc !important; border-radius: 0 10px 10px 0; }
        .ss-dropdown-list::-webkit-scrollbar-thumb { background: #cbd5e0 !important; border-radius: 7px; border: 3px solid #f8fafc !important; min-height: 50px; }
        .ss-dropdown-list::-webkit-scrollbar-thumb:hover { background: var(--accent) !important; }
        .ss-dropdown-list { scrollbar-width: auto !important; scrollbar-color: #cbd5e0 #f8fafc !important; overflow-y: scroll !important; }
        .ss-option { transition: background 0.1s; }
        .ss-option:hover { background: #f0fdf4 !important; }
        @keyframes ssDropIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ssDropInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div 
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: disabled ? '#f8fafc' : '#fff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          minHeight: '38px',
          color: displayText ? 'inherit' : 'var(--muted)',
          fontSize: 13,
          boxShadow: isOpen ? '0 0 0 2px rgba(37, 99, 235, 0.2)' : 'none',
          borderColor: isOpen ? 'var(--accent)' : 'var(--border)'
        }}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {displayText || placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>

      {isOpen && (
        <div ref={dropdownRef} style={{
          position: 'absolute',
          ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
          left: 0,
          right: 0,
          background: '#fff',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 12px 28px -4px rgba(0, 0, 0, 0.15), 0 4px 10px -2px rgba(0, 0, 0, 0.08)',
          zIndex: 9999,
          maxHeight: 300,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: dropUp ? 'ssDropInUp 0.15s ease' : 'ssDropIn 0.15s ease'
        }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}>
                <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input 
                autoFocus
                type="text" 
                placeholder="Type to search..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px 8px 32px',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: 6,
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                  background: '#fff',
                  fontFamily: 'inherit'
                }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>
          </div>
          
          <div className="ss-dropdown-list" style={{ overflowY: 'auto', flex: 1, padding: 6 }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                No matches found
              </div>
            ) : (
              filteredOptions.map((opt, i) => {
                const text = typeof opt === 'object' ? opt[displayKey] : opt;
                const val = typeof opt === 'object' ? opt[returnKey] : opt;
                const isSelected = value === val;
                
                return (
                  <div 
                    key={i}
                    className="ss-option"
                    onClick={() => handleSelect(opt)}
                    style={{
                      padding: '9px 12px',
                      cursor: 'pointer',
                      borderRadius: 6,
                      fontSize: 13,
                      background: isSelected ? '#f0fdf4' : 'transparent',
                      color: isSelected ? '#15803d' : '#334155',
                      fontWeight: isSelected ? 600 : 400,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                      marginBottom: 1
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <span>{text}</span>
                      {isSelected && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                    </div>
                    {typeof opt === 'object' && (subKey ? opt[subKey] : (opt.code || opt.sku)) && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                        {subKey ? opt[subKey] : (opt.code || opt.sku)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
