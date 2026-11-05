import { useState } from 'react';
import { SCHEMA } from '../../constants/defaults';
import { benchmarkPresets } from '../../constants/benchmarkPresets';
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

export function ControlSidebar({ params, badInputs, onChange, onApplyPreset }) {
  const [selectedPresetId, setSelectedPresetId] = useState('');

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

  const handleSelectPreset = (e) => {
    const presetId = e.target.value;
    setSelectedPresetId(presetId);
    const preset = benchmarkPresets.find((p) => p.id === presetId);
    if (preset && onApplyPreset) {
      onApplyPreset(preset.config);
    }
  };

  const selectedPreset = benchmarkPresets.find((p) => p.id === selectedPresetId);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Rover wheel DEM</h1>
        <p className="sub">
          Every input is free entry. Values are checked, not capped. Lengths in mm.
        </p>
      </div>
      <div id="controls" className="sidebar-controls">
        <details open>
          <summary>Research Benchmarks</summary>
          <div className="section-body">
            <div className="row" style={{ gridTemplateColumns: '1fr' }}>
              <select
                value={selectedPresetId}
                onChange={handleSelectPreset}
                aria-label="Select Published Benchmark"
              >
                <option value="" disabled>
                  Select a published benchmark paper...
                </option>
                {benchmarkPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.presetName}
                  </option>
                ))}
              </select>
            </div>
            {selectedPreset && (
              <p className="sub" style={{ margin: '6px 0 2px', fontSize: '11.5px' }}>
                {selectedPreset.description}
              </p>
            )}
          </div>
        </details>

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
