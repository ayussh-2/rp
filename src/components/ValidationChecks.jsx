export function ValidationChecks({ checks, isBedDifferent }) {
  const { E = [], W = [], I = [] } = checks || {};

  return (
    <ul className="checks" id="checks">
      {isBedDifferent && (
        <li className="w">
          Bed or contact settings differ from the current bed. &quot;Build bed and run&quot; applies them.
        </li>
      )}
      {E.map((msg, i) => (
        <li key={'e_' + i} className="e">
          {msg}
        </li>
      ))}
      {W.map((msg, i) => (
        <li key={'w_' + i} className="w">
          {msg}
        </li>
      ))}
      {I.map((msg, i) => (
        <li key={'i_' + i} className="i">
          {msg}
        </li>
      ))}
    </ul>
  );
}
