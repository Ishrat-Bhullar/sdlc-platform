import React, { useState } from 'react';
import { User, Edit3 } from 'lucide-react';

interface AvatarSelectorProps {
  value: { mode: 'preset' | 'custom', value: string };
  onChange: (val: { mode: 'preset' | 'custom', value: string }) => void;
}

const PRESETS = [
  'Professional Male', 'Professional Female', 'CEO', 'Engineer', 'Doctor', 
  'Teacher', 'Scientist', 'Farmer', 'Police Officer', 'Lawyer', 'Student', 
  'Government Officer', 'Minister', 'Chief Minister', 'Prime Minister', 
  'Village Woman', 'Construction Worker', 'Factory Worker', 'Poor Family', 
  'Child', 'News Anchor', '3D Avatar', 'Cartoon'
];

export function AvatarSelector({ value, onChange }: AvatarSelectorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
          <User size={14} /> Presenter
        </label>
        <div className="flex bg-dark-bg rounded p-0.5">
          <button 
            className={`px-2 py-0.5 text-[10px] rounded ${value.mode === 'preset' ? 'bg-dark-border' : ''}`}
            onClick={() => onChange({ mode: 'preset', value: PRESETS[0] })}
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
          {PRESETS.map(p => <option key={p}>{p}</option>)}
        </select>
      ) : (
        <textarea 
          className="w-full bg-dark-bg border border-dark-border rounded-md px-3 py-2 text-sm h-20 resize-none"
          placeholder="e.g. Generate a 45-year-old doctor explaining the healthcare project."
          value={value.value}
          onChange={(e) => onChange({ mode: 'custom', value: e.target.value })}
        />
      )}
    </div>
  );
}