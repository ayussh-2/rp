import { useState } from 'react';
import { SCHEMA } from '../../constants/defaults';
import { ControlField } from './ControlField';

function DetailsSection({ title, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

export function ControlSidebar({ params, badInputs, onChange }) {
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
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Rover wheel DEM</h1>
        <p className="sub">
          Every input is free entry. Values are checked, not capped. Lengths in mm.
        </p>
      </div>
      <div id="controls" className="sidebar-controls">
        {groups.map((group) => (
          <DetailsSection
            key={group.title}
            title={group.title}
            defaultOpen={group.open}
          >
            {group.items.map((item) => (
              <ControlField
                key={item.k}
                schema={item}
                value={params[item.k]}
                isBad={!!badInputs[item.k]}
                onChange={onChange}
              />
            ))}
          </DetailsSection>
        ))}
      </div>
    </aside>
  );
}
