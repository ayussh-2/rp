export function ControlField({
  schema,
  value,
  isBad,
  onChange,
}) {
  const id = 'p_' + schema.k;

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

  // Number input with unit
  const formatVal = (v) => {
    if (schema.blankAuto && v < 0) return '';
    const d = v * schema.sc;
    return String(+d.toPrecision(6));
  };

  const handleInput = (e) => {
    const raw = e.target.value;
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
      <label htmlFor={id}>{schema.label}</label>
      <input
        type="number"
        step="any"
        id={id}
        className={isBad ? 'bad' : ''}
        defaultValue={formatVal(value)}
        key={schema.k + '_' + (typeof value === 'number' ? value : '')}
        onInput={handleInput}
      />
      <span className="u">{schema.unit}</span>
    </div>
  );
}
