import React, { useState } from 'react';
import { AvatarSelector } from './AvatarSelector';
import { SceneSelector } from './SceneSelector';
import { Settings, Play, Mic, Globe, Layers } from 'lucide-react';

interface StudioConfigurationProps {
  onConfigChange: (config: any) => void;
  onGenerate: () => void;
  initialConfig?: any;
}

export function StudioConfiguration({ onConfigChange, onGenerate, initialConfig }: StudioConfigurationProps) {
  const [config, setConfig] = useState(initialConfig || {
    mode: 'Presentation + Video',
    theme: 'EY Theme',
    presentationMode: 'Executive Summary',
    avatar: { mode: 'preset', value: 'Professional Male' },
    scene: { mode: 'preset', value: 'Office' },
    voice: { language: 'en-US', speed: 1.0 }
  });

  const updateConfig = (key: string, value: any) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  return (
    <div className="h-full bg-dark-surface border-r border-dark-border p-6 overflow-y-auto">
      <div className="flex items-center gap-2 mb-6 text-ey-yellow">
        <Settings size={20} />
        <h2 className="font-semibold text-lg">Studio Configuration</h2>
      </div>

      <div className="space-y-6">
        {/* Output Mode */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">Output Pipeline</label>
          <select 
            className="w-full bg-dark-bg border border-dark-border rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-ey-yellow outline-none"
            value={config.mode}
            onChange={(e) => updateConfig('mode', e.target.value)}
          >
            <option>Presentation Only</option>
            <option>Video Only</option>
            <option>Presentation + Video</option>
          </select>
        </div>

        {/* Theme & Mode */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-2">Theme</label>
            <select 
              className="w-full bg-dark-bg border border-dark-border rounded-md px-3 py-2 text-sm"
              value={config.theme}
              onChange={(e) => updateConfig('theme', e.target.value)}
            >
              {['EY Theme', 'Corporate', 'Modern', 'Minimal', 'Startup', 'Dark'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-2">Presentation Mode</label>
            <select 
              className="w-full bg-dark-bg border border-dark-border rounded-md px-3 py-2 text-sm"
              value={config.presentationMode}
              onChange={(e) => updateConfig('presentationMode', e.target.value)}
            >
              {['Executive Summary', 'Technical Review', 'Investor Pitch', 'Academic Presentation'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <hr className="border-dark-border" />

        <AvatarSelector 
          value={config.avatar} 
          onChange={(val) => updateConfig('avatar', val)} 
        />

        <SceneSelector 
          value={config.scene} 
          onChange={(val) => updateConfig('scene', val)} 
        />

        {/* Voice Settings */}
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-text-muted mb-2">
            <Mic size={14} /> Voice Settings
          </label>
          <div className="flex gap-2">
            <select 
              className="flex-1 bg-dark-bg border border-dark-border rounded-md px-3 py-2 text-sm"
              value={config.voice.language}
              onChange={(e) => updateConfig('voice', {...config.voice, language: e.target.value})}
            >
              <option value="en-US">English (US)</option>
              <option value="hi-IN">Hindi (IN)</option>
              <option value="es-ES">Spanish (ES)</option>
            </select>
          </div>
        </div>

        <button 
          onClick={onGenerate}
          className="w-full bg-ey-yellow text-dark-bg font-bold py-3 rounded-md flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
        >
          <Play size={16} /> Generate Presentation
        </button>
      </div>
    </div>
  );
}