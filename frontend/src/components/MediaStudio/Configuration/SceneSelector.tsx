import React from 'react';
import { LayoutGrid } from 'lucide-react';

interface SceneSelectorProps {
  value: { mode: 'preset' | 'custom', value: string };
  onChange: (val: { mode: 'preset' | 'custom', value: string }) => void;
}

const SCENES = [
  'Office', 'Boardroom', 'Hospital', 'School', 'Village', 'Farm', 
  'Factory', 'Construction Site', 'Courtroom', 'Laboratory', 
  'Police Station', 'Government Office', 'News Studio'
];

export function SceneSelector({ value, onChange }: SceneSelectorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
          <LayoutGrid size={14} /> Scene
        </label>
        <div className="flex bg-dark-bg rounded p-0.5">
          <button 
            className={`px-2 py-0.5 text-[10px] rounded ${value.mode === 'preset' ? 'bg-dark-border' : ''}`}
            onClick={() => onChange({ mode: 'preset', value: SCENES[0] })}
          >Preset</button>
          <button 
            className={`px-2 py-0.5 text-[10px] rounded ${value.mode === 'custom' ? 'bg-dark-border' : ''}`}
            onClick={() => onChange({ mode: 'custom', value: '' })}
          >Custom</button>
        </div>
      </div>

      {value.mode === 'preset' ? (
        <select 
          className="w-full bg-dark-bg border border-dark-border rounded-md px-3 py-2 text-sm"
          value={value.value}
          onChange={(e) => onChange({ mode: 'preset', value: e.target.value })}
        >
          {SCENES.map(s => <option key={s}>{s}</option>)}
        </select>
      ) : (
        <input 
          type="text"
          className="w-full bg-dark-bg border border-dark-border rounded-md px-3 py-2 text-sm"
          placeholder="Describe your custom scene..."
          value={value.value}
          onChange={(e) => onChange({ mode: 'custom', value: e.target.value })}
        />
      )}
    </div>
  );
}