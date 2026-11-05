import { useState, useEffect, useRef, useCallback } from 'react';

export function ControlField({ schema, value, isBad, onChange }) {
  const id = 'p_' + schema.k;

  const formatVal = useCallback(
    (v) => {
      if (schema.blankAuto && v < 0) return '';
      if (v === undefined || v === null || isNaN(v)) return '';
      const d = v * schema.sc;
      return String(+d.toPrecision(6));
    },
    [schema.blankAuto, schema.sc]
  );

  const [text, setText] = useState(() => formatVal(value));
  const isFocusedRef = useRef(false);

  // Sync from outside only when not actively typing/focused
  useEffect(() => {
    if (!isFocusedRef.current) {
      setText(formatVal(value));
    }
  }, [value, formatVal]);

  if (schema.type === 'check') {
    return (
      <div className="row chk">
        <input
          type="checkbox"
          id={id}
          checked={!!value}
          onChange={(e) => onChange(schema.k, e.target.checked, false)}
        />
        <label htmlFor={id}>{schema.label}</label>
      </div>
    );
  }

  if (schema.type === 'select') {
    return (
      <div className="row">
        <label htmlFor={id}>{schema.label}</label>
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(schema.k, e.target.value, false)}
        >
          {schema.opts.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const handleInput = (e) => {
    const raw = e.target.value;
    setText(raw);

    if (schema.blankAuto && raw.trim() === '') {
      onChange(schema.k, -1, false);
      return;
    }

    const v = parseFloat(raw);
    let ok = isFinite(v);
    if (ok && schema.pos && v <= 0) ok = false;
    if (ok && schema.min !== undefined && v < schema.min) ok = false;
    if (ok && schema.max !== undefined && v > schema.max) ok = false;
    if (ok && schema.int && Math.floor(v) !== v) ok = false;

    onChange(schema.k, ok ? v / schema.sc : raw, !ok);
  };

  return (
    <div className="row">
      <label htmlFor={id} title={schema.label}>
        {schema.label}
      </label>
      <input
        type="number"
        step="any"
        id={id}
        className={isBad ? 'bad' : ''}
        value={text}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          if (!isBad && typeof value === 'number') {
            setText(formatVal(value));
          }
        }}
        onChange={handleInput}
      />
      <span className="u">{schema.unit}</span>
    </div>
  );
}
