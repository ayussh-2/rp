import { SCHEMA } from '../../constants/defaults';
import { ControlField } from './ControlField';

export function ControlSidebar({ params, badInputs, onChange }) {
  // Group SCHEMA items by section header
  const groups = [];
  let currentGroup = null;

  for (const s of SCHEMA) {
    if (s.g) {
      currentGroup = { title: s.g, open: !!s.open, items: [] };
      groups.push(currentGroup);
    } else if (currentGroup) {
      currentGroup.items.push(s);
    }
  }

  return (
    <aside>
      <h1>Rover wheel DEM</h1>
      <p className="sub">
        Every input is free entry. Values are checked, not capped. Lengths in mm.
      </p>
      <div id="controls">
        {groups.map((group) => (
          <details key={group.title} defaultOpen={group.open}>
            <summary>{group.title}</summary>
            {group.items.map((item) => (
              <ControlField
                key={item.k}
                schema={item}
                value={params[item.k]}
                isBad={!!badInputs[item.k]}
                onChange={onChange}
              />
            ))}
          </details>
        ))}
      </div>
    </aside>
  );
}
