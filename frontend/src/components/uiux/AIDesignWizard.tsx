import { useState } from 'react';
import { ArrowLeft, ArrowRight, Sparkles, X, Check, Monitor, Smartphone, Tablet } from 'lucide-react';

export interface WizardConfig {
  prompt: string;
  pages: string[];
  platform: string;
  color: string;
  style: string;
  users: string;
  responsive: string;
}

interface AIDesignWizardProps {
  onComplete: (wizardConfig: WizardConfig) => void;
  onClose?: () => void;
  submitting?: boolean;
}

// Ported from Bhumika's AI Design Studio wizard — pure input-collection UI,
// no backend calls of its own. `onComplete` is wired by the caller
// (UIUXWorkspace) to POST /agents/uiux with the collected prompt/pages.
export function AIDesignWizard({ onComplete, onClose, submitting }: AIDesignWizardProps) {
  const [step, setStep] = useState<number>(1);
  const [prompt, setPrompt] = useState<string>('');
  const [pages, setPages] = useState<string[]>(['Home', 'Login', 'Dashboard']);
  const [platform, setPlatform] = useState<string>('Web Portal');
  const [color, setColor] = useState<string>('Modern SaaS');
  const [style, setStyle] = useState<string>('Bento Grid Panel');
  const [users, setUsers] = useState<string>('General Users');
  const [responsive, setResponsive] = useState<string>('Fluid Desktop Grid');

  const pagePresets = [
    { name: 'Home', desc: 'Landing / Gateway' },
    { name: 'Login', desc: 'Authentication' },
    { name: 'Dashboard', desc: 'Primary workspace / metrics' },
    { name: 'Settings', desc: 'User & account preferences' },
    { name: 'Detail View', desc: 'Single-record deep dive' },
    { name: 'Reports', desc: 'Data & analytics views' },
  ];

  const handleTogglePage = (pName: string) => {
    setPages((prev) => (prev.includes(pName) ? prev.filter((p) => p !== pName) : [...prev, pName]));
  };

  const handleSubmit = () => {
    onComplete({ prompt, pages, platform, color, style, users, responsive });
  };

  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl shadow-2xl overflow-hidden relative p-6 space-y-5 max-w-4xl w-full mx-auto text-white">
      <div className="flex items-center justify-between border-b border-dark-border pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-ey-yellow/15 border border-ey-yellow/30 text-ey-yellow">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-black uppercase tracking-tight text-text-primary">AI Design Studio Wizard</h2>
            <p className="text-[10px] text-text-muted mt-0.5">Generate screens, style, and layout via the UI/UX Design Agent</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono font-bold text-ey-yellow uppercase bg-ey-yellow/15 px-2.5 py-1 rounded border border-ey-yellow/20">
            Stage {step} / 4
          </span>
          {onClose && (
            <button onClick={onClose} className="p-1 hover:bg-dark-cardHover rounded-lg transition-colors">
              <X size={16} className="text-text-muted hover:text-white" />
            </button>
          )}
        </div>
      </div>

      <div className="relative h-1 w-full bg-dark-bg rounded-full overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-ey-yellow to-amber-400 transition-all duration-300"
          style={{ width: `${(step / 4) * 100}%` }}
        />
      </div>

      <div className="min-h-[300px] flex flex-col justify-between py-1">
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-bold text-text-primary flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-ey-yellow/10 border border-ey-yellow/25 text-ey-yellow flex items-center justify-center text-[10px] font-bold">1</span>
                Describe the application
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5">This becomes the project description fed to the UI/UX Design Agent.</p>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you want to design..."
              className="w-full h-24 p-3.5 rounded-xl bg-dark-bg border border-dark-border text-xs text-white focus:outline-none focus:border-ey-yellow/40 resize-none"
            />
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { id: 'Web Portal', label: 'Web Application', icon: Monitor },
                { id: 'Mobile Companion', label: 'Mobile Native', icon: Smartphone },
                { id: 'Desktop Client', label: 'Desktop Client', icon: Tablet },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                    platform === p.id ? 'bg-ey-yellow/5 border-ey-yellow' : 'bg-dark-bg border-dark-border hover:border-dark-border-light'
                  }`}
                >
                  <p.icon size={14} className={platform === p.id ? 'text-ey-yellow' : 'text-text-muted'} />
                  <span className={`text-[11px] font-black block ${platform === p.id ? 'text-ey-yellow' : 'text-text-primary'}`}>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-bold text-text-primary flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-ey-yellow/10 border border-ey-yellow/25 text-ey-yellow flex items-center justify-center text-[10px] font-bold">2</span>
                Select target pages
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5">Mentioned to the agent as a starting point — it may add more.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[180px] overflow-y-auto pr-1">
              {pagePresets.map((preset) => {
                const isSelected = pages.includes(preset.name);
                return (
                  <button
                    key={preset.name}
                    onClick={() => handleTogglePage(preset.name)}
                    className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all ${
                      isSelected ? 'bg-ey-yellow/5 border-ey-yellow' : 'bg-dark-bg border-dark-border hover:border-dark-border-light'
                    }`}
                  >
                    <div className="min-w-0 pr-1">
                      <span className={`text-[10px] font-black block truncate ${isSelected ? 'text-ey-yellow' : 'text-text-primary'}`}>{preset.name}</span>
                      <span className="text-[8px] text-text-muted block mt-0.5 truncate">{preset.desc}</span>
                    </div>
                    <div className={`h-4.5 w-4.5 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? 'bg-ey-yellow border-ey-yellow text-black' : 'border-dark-border'}`}>
                      {isSelected && <Check size={11} strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-bold text-text-primary flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-ey-yellow/10 border border-ey-yellow/25 text-ey-yellow flex items-center justify-center text-[10px] font-bold">3</span>
                Preferred style direction
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5">A hint for the agent — it will still generate multiple style options for you to pick from.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {['Modern SaaS', 'Minimal', 'Enterprise Dashboard', 'Glassmorphism'].map((item) => {
                const isSelected = color === item;
                return (
                  <button
                    key={item}
                    onClick={() => setColor(item)}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      isSelected ? 'bg-ey-yellow/5 border-ey-yellow' : 'bg-dark-bg border-dark-border hover:border-dark-border-light'
                    }`}
                  >
                    <span className={`text-[10px] font-black block ${isSelected ? 'text-ey-yellow' : 'text-text-primary'}`}>{item}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-bold text-text-primary flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-ey-yellow/10 border border-ey-yellow/25 text-ey-yellow flex items-center justify-center text-[10px] font-bold">4</span>
                Audience & layout
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">Target Persona</label>
                <select value={users} onChange={(e) => setUsers(e.target.value)} className="w-full mt-1 p-2 bg-dark-bg border border-dark-border text-[11px] rounded-lg focus:border-ey-yellow focus:outline-none text-white">
                  <option value="General Users">General Users</option>
                  <option value="Enterprise / B2B">Enterprise / B2B</option>
                  <option value="Internal Operators">Internal Operators</option>
                </select>
                <label className="text-[9px] font-bold text-text-muted uppercase tracking-wider block pt-1">Responsive Target</label>
                <select value={responsive} onChange={(e) => setResponsive(e.target.value)} className="w-full mt-1 p-2 bg-dark-bg border border-dark-border text-[11px] rounded-lg focus:border-ey-yellow focus:outline-none text-white">
                  <option value="Fluid Desktop Grid">Fluid Desktop Grid</option>
                  <option value="Touch Tablet Optimized">Touch Tablet Optimized</option>
                  <option value="Mobile First">Mobile First</option>
                </select>
              </div>
              <div>
                <label className="text-[9px] font-bold text-text-muted uppercase tracking-wider block mb-1">Layout Blueprint</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {['Bento Grid Panel', 'Split Side Navigation', 'Multi-Step Wizard', 'Simple Stacked Panel'].map((s) => {
                    const isSelected = style === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setStyle(s)}
                        className={`p-2 rounded-lg border text-left transition-all ${
                          isSelected ? 'bg-ey-yellow/5 border-ey-yellow' : 'bg-dark-bg border-dark-border hover:border-dark-border-light'
                        }`}
                      >
                        <span className={`text-[10px] font-black block ${isSelected ? 'text-ey-yellow' : 'text-text-primary'}`}>{s}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-dark-border pt-4 mt-4">
          <button
            onClick={() => setStep((prev) => Math.max(1, prev - 1))}
            disabled={step === 1}
            className="flex items-center gap-1 bg-dark-cardHover border border-dark-border px-3 py-1.5 rounded-lg text-[10px] font-bold text-white disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <ArrowLeft size={12} /> <span>Back</span>
          </button>
          <div className="flex items-center gap-2">
            {step < 4 ? (
              <button
                onClick={() => setStep((prev) => prev + 1)}
                className="flex items-center gap-1 bg-ey-yellow text-black font-black px-4 py-1.5 rounded-lg text-[10px] hover:opacity-90"
              >
                <span>Next</span> <ArrowRight size={12} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting || !prompt.trim()}
                className="flex items-center gap-1.5 bg-gradient-to-r from-ey-yellow to-amber-400 text-black font-black px-5 py-2 rounded-lg text-[10px] hover:opacity-95 disabled:opacity-40"
              >
                <Sparkles size={12} /> <span>{submitting ? 'Generating...' : 'Generate Design'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
