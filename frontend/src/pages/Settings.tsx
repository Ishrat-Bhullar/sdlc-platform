import { useState } from 'react';
import {
  User,
  Shield,
  Bell,
  Palette,
  Key,
  Globe,
  Save,
  RefreshCw,
  Boxes,
  Cloud,
  Lock,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react';
import { Card, StatusBadge } from '../components/ui/Card';
import { useAuth } from '../lib/auth';
import { fastApiRequest } from '../lib/api';
import { useEffect } from 'react';

interface AiModelInfo {
  active_model: string;
  fallback_chain: string[];
  preferred: { id: string; label: string }[];
  installed: string[];
}

function AiModelSettings() {
  const [info, setInfo] = useState<AiModelInfo | null>(null);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fastApiRequest<{ ok: boolean; message: string }>(
        '/settings/ai-model/test', { method: 'POST', body: { model: selected } });
      setTestOk(!!r.ok); setTestResult(r.message);
    } catch {
      setTestOk(false); setTestResult('Could not reach the local model endpoint.');
    }
    setTesting(false);
  };

  useEffect(() => {
    fastApiRequest<AiModelInfo>('/settings/ai-model')
      .then((d) => { setInfo(d); setSelected(d.active_model); })
      .catch(() => setInfo({ active_model: '', fallback_chain: [], preferred: [
        { id: 'qwen3:32b', label: 'Qwen3 32B (best quality)' },
        { id: 'qwen3:14b', label: 'Qwen3 14B (balanced)' },
        { id: 'deepseek-r1:14b', label: 'DeepSeek R1 14B (reasoning)' },
      ], installed: [] }));
  }, []);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await fastApiRequest('/settings/ai-model', { method: 'POST', body: { model: selected } });
      setSaved(true);
    } catch { /* surfaced by UI state */ }
    setSaving(false);
  };

  const isInstalled = (id: string) => info?.installed?.some(
    (n) => n === id || n.split(':')[0] === id.split(':')[0]);

  return (
    <Card>
      <h3 className="section-title">Local AI Model</h3>
      <p className="text-xs text-text-muted mb-4">
        All generation runs locally through Ollama. Pick the primary model; the platform
        automatically falls back down the chain (Qwen3 32B → 14B → DeepSeek R1) if a model isn't installed.
      </p>
      <div className="space-y-3">
        {(info?.preferred || []).map((m) => {
          const active = selected === m.id;
          const installed = isInstalled(m.id);
          return (
            <button key={m.id} onClick={() => setSelected(m.id)}
              className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-all w-full ${active ? 'border-ey-yellow bg-ey-yellow/10' : 'border-dark-border bg-dark-bg hover:border-dark-border-light'}`}>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${active ? 'bg-ey-yellow/20' : 'bg-dark-card'}`}>
                <Boxes className={`h-5 w-5 ${active ? 'text-ey-yellow' : 'text-text-secondary'}`} />
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${active ? 'text-ey-yellow' : 'text-text-primary'}`}>{m.label}</p>
                <p className="text-xs text-text-muted mt-0.5 font-mono">{m.id}</p>
              </div>
              <StatusBadge status={installed ? 'success' : 'idle'}>
                {installed ? 'Installed' : 'Not pulled'}
              </StatusBadge>
              {active && <Check className="h-4 w-4 text-ey-yellow flex-shrink-0" />}
            </button>
          );
        })}
      </div>
      {info?.fallback_chain?.length ? (
        <div className="mt-4 text-xs text-text-muted">
          <span className="font-medium text-text-secondary">Fallback chain: </span>
          {info.fallback_chain.filter(Boolean).join('  →  ')}
        </div>
      ) : null}
      <div className="mt-5 flex items-center gap-3">
        <button onClick={save} disabled={saving || !selected}
          className="flex items-center gap-2 rounded-lg bg-ey-yellow px-4 py-2 text-sm font-semibold text-dark-bg hover:opacity-90 disabled:opacity-50">
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saved ? 'Saved as Default' : 'Save as Default'}
        </button>
        <button onClick={testConnection} disabled={testing}
          className="flex items-center gap-2 rounded-lg border border-dark-border px-4 py-2 text-sm font-medium text-text-secondary hover:border-ey-yellow/40 disabled:opacity-50">
          {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
          Test Connection
        </button>
      </div>
      {testResult && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${testOk ? 'border-status-success/30 bg-status-success/5 text-status-success' : 'border-status-error/30 bg-status-error/5 text-status-error'}`}>
          {testOk ? <Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> : null}
          <span>{testResult}</span>
        </div>
      )}
    </Card>
  );
}

const settingsSections = [
  { id: 'profile', name: 'Profile', icon: User },
  { id: 'security', name: 'Security', icon: Shield },
  { id: 'notifications', name: 'Notifications', icon: Bell },
  { id: 'appearance', name: 'Appearance', icon: Palette },
  { id: 'integrations', name: 'Integrations', icon: Globe },
  { id: 'build-type', name: 'Build Type', icon: Boxes },
  { id: 'ai-model', name: 'Local AI Model', icon: Boxes },
  { id: 'byok', name: 'BYOK Settings', icon: Key },
  { id: 'api', name: 'API Keys', icon: Key },
];

const buildTypes = [
  { id: 'open-source', name: 'Open Source', description: 'Publicly accessible, community-driven projects', icon: Globe },
  { id: 'private-enterprise', name: 'Private Enterprise', description: 'Proprietary enterprise applications with restricted access', icon: Lock },
  { id: 'internal-organization', name: 'Internal Organization', description: 'Internal tools and platforms for organizational use', icon: Boxes },
];

const byokProviders = [
  { id: 'openai', name: 'OpenAI', keyLabel: 'OpenAI API Key', placeholder: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', keyLabel: 'Anthropic API Key', placeholder: 'sk-ant-...' },
  { id: 'gemini', name: 'Gemini', keyLabel: 'Gemini API Key', placeholder: 'AIza...' },
  { id: 'azure-openai', name: 'Azure OpenAI', keyLabel: 'Azure OpenAI Key', placeholder: 'Azure key...' },
  { id: 'aws-bedrock', name: 'AWS Bedrock', keyLabel: 'AWS Bedrock Key', placeholder: 'AKIA...' },
  { id: 'ollama', name: 'Ollama', keyLabel: 'Ollama Endpoint', placeholder: 'http://localhost:11434' },
];

export function Settings() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState('profile');
  const [settings, setSettings] = useState({
    email: user?.email || 'user@example.com',
    name: user?.email ? user.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'User',
    role: 'Enterprise Admin',
    notifications: {
      email: true,
      push: true,
      approvals: true,
      agents: false,
    },
    theme: 'dark',
  });
  const [buildType, setBuildType] = useState('private-enterprise');
  const [byokKeys, setByokKeys] = useState<Record<string, string>>({});
  const [byokEnabled, setByokEnabled] = useState<Record<string, boolean>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="mt-1 text-sm text-text-muted">Manage your account and preferences</p>
        </div>
        <button className="btn-primary text-sm">
          <Save className="mr-2 h-4 w-4" />
          Save Changes
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Settings Navigation */}
        <div className="lg:col-span-1">
          <Card>
            <nav className="space-y-1">
              {settingsSections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center gap-3 rounded-lg p-3 transition-all ${
                      activeSection === section.id
                        ? 'bg-ey-yellow/10 text-ey-yellow'
                        : 'text-text-secondary hover:text-text-primary hover:bg-dark-bg'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-sm font-medium">{section.name}</span>
                  </button>
                );
              })}
            </nav>
          </Card>
        </div>

        {/* Settings Content */}
        <div className="lg:col-span-3 space-y-6">
          {activeSection === 'profile' && (
            <Card>
              <h3 className="section-title">Profile Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">Full Name</label>
                  <input
                    type="text"
                    value={settings.name}
                    onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">Email</label>
                  <input
                    type="email"
                    value={settings.email}
                    onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">Role</label>
                  <input
                    type="text"
                    value={settings.role}
                    disabled
                    className="input-field w-full opacity-50"
                  />
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'security' && (
            <>
              <Card>
                <h3 className="section-title">Security Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-dark-bg">
                    <div>
                      <p className="text-sm text-text-primary">Two-Factor Authentication</p>
                      <p className="text-xs text-text-muted">Add an extra layer of security</p>
                    </div>
                    <StatusBadge status="success">Enabled</StatusBadge>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-dark-bg">
                    <div>
                      <p className="text-sm text-text-primary">Session Timeout</p>
                      <p className="text-xs text-text-muted">Automatic logout after inactivity</p>
                    </div>
                    <span className="text-sm text-text-secondary">30 minutes</span>
                  </div>
                  <button className="btn-secondary text-sm">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reset Password
                  </button>
                </div>
              </Card>
              <Card>
                <h3 className="section-title">Active Sessions</h3>
                <div className="space-y-2">
                  {[
                    { device: 'Chrome on MacOS', location: 'San Francisco, CA', current: true },
                    { device: 'Safari on iPhone', location: 'San Francisco, CA', current: false },
                  ].map((session, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-dark-bg">
                      <div>
                        <p className="text-sm text-text-primary">{session.device}</p>
                        <p className="text-xs text-text-muted">{session.location}</p>
                      </div>
                      {session.current ? (
                        <StatusBadge status="success">Current</StatusBadge>
                      ) : (
                        <button className="text-xs text-status-error">Revoke</button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}

          {activeSection === 'notifications' && (
            <Card>
              <h3 className="section-title">Notification Preferences</h3>
              <div className="space-y-3">
                {[
                  { key: 'email', label: 'Email Notifications', desc: 'Receive updates via email' },
                  { key: 'push', label: 'Push Notifications', desc: 'Browser push notifications' },
                  { key: 'approvals', label: 'Approval Alerts', desc: 'Get notified for pending approvals' },
                  { key: 'agents', label: 'Agent Activity', desc: 'Updates on agent progress' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-3 rounded-lg bg-dark-bg">
                    <div>
                      <p className="text-sm text-text-primary">{item.label}</p>
                      <p className="text-xs text-text-muted">{item.desc}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.notifications[item.key as keyof typeof settings.notifications]}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            notifications: { ...settings.notifications, [item.key]: e.target.checked },
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 rounded-full bg-dark-border peer peer-checked:bg-ey-yellow after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                    </label>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {activeSection === 'appearance' && (
            <Card>
              <h3 className="section-title">Appearance Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-text-muted mb-2 block">Theme</label>
                  <div className="flex gap-3">
                    {['dark', 'light', 'system'].map((theme) => (
                      <button
                        key={theme}
                        onClick={() => setSettings({ ...settings, theme })}
                        className={`px-4 py-2 rounded-lg text-sm capitalize ${
                          settings.theme === theme
                            ? 'bg-ey-yellow/20 text-ey-yellow border border-ey-yellow/30'
                            : 'bg-dark-bg text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'integrations' && (
            <Card>
              <h3 className="section-title">Connected Services</h3>
              <div className="space-y-3">
                {[
                  { name: 'Google Workspace', status: 'connected' },
                  { name: 'Microsoft 365', status: 'connected' },
                  { name: 'Slack', status: 'disconnected' },
                  { name: 'Jira', status: 'connected' },
                ].map((integration, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-dark-bg">
                    <span className="text-sm text-text-primary">{integration.name}</span>
                    <StatusBadge status={integration.status === 'connected' ? 'success' : 'idle'}>
                      {integration.status}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {activeSection === 'build-type' && (
            <Card>
              <h3 className="section-title">Build Type</h3>
              <p className="text-xs text-text-muted mb-4">Select the deployment and distribution model for your projects</p>
              <div className="space-y-3">
                {buildTypes.map((type) => {
                  const Icon = type.icon;
                  const isSelected = buildType === type.id;
                  return (
                    <button
                      key={type.id}
                      onClick={() => setBuildType(type.id)}
                      className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-all w-full ${
                        isSelected
                          ? 'border-ey-yellow bg-ey-yellow/10'
                          : 'border-dark-border bg-dark-bg hover:border-dark-border-light'
                      }`}
                    >
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isSelected ? 'bg-ey-yellow/20' : 'bg-dark-card'}`}>
                        <Icon className={`h-5 w-5 ${isSelected ? 'text-ey-yellow' : 'text-text-secondary'}`} />
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${isSelected ? 'text-ey-yellow' : 'text-text-primary'}`}>{type.name}</p>
                        <p className="text-xs text-text-muted mt-0.5">{type.description}</p>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-ey-yellow flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {activeSection === 'ai-model' && <AiModelSettings />}

          {activeSection === 'byok' && (
            <Card>
              <h3 className="section-title">BYOK Settings</h3>
              <p className="text-xs text-text-muted mb-4">Bring your own API keys for LLM providers. Keys are stored securely and used for agent orchestration.</p>
              <div className="space-y-3">
                {byokProviders.map((provider) => {
                  const isEnabled = byokEnabled[provider.id] || false;
                  return (
                    <div key={provider.id} className={`rounded-lg border p-4 transition-all ${isEnabled ? 'border-ey-yellow/30 bg-ey-yellow/5' : 'border-dark-border bg-dark-bg'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Cloud className={`h-4 w-4 ${isEnabled ? 'text-ey-yellow' : 'text-text-muted'}`} />
                          <span className="text-sm font-medium text-text-primary">{provider.name}</span>
                          {isEnabled && <StatusBadge status="success">Connected</StatusBadge>}
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) =>
                              setByokEnabled((prev) => ({ ...prev, [provider.id]: e.target.checked }))
                            }
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 rounded-full bg-dark-border peer-checked:bg-ey-yellow after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type={visibleKeys[provider.id] ? 'text' : 'password'}
                          value={byokKeys[provider.id] || ''}
                          onChange={(e) =>
                            setByokKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))
                          }
                          placeholder={provider.placeholder}
                          disabled={!isEnabled}
                          className="input-field flex-1 font-mono text-xs"
                        />
                        <button
                          onClick={() =>
                            setVisibleKeys((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))
                          }
                          disabled={!isEnabled}
                          className="rounded-lg border border-dark-border bg-dark-card p-2 text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
                        >
                          {visibleKeys[provider.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                        <button
                          disabled={!isEnabled || !byokKeys[provider.id]}
                          className="rounded-lg bg-ey-yellow/20 px-3 py-2 text-xs text-ey-yellow hover:bg-ey-yellow/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Save
                        </button>
                      </div>
                      <p className="text-[10px] text-text-muted mt-1">{provider.keyLabel}</p>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {activeSection === 'api' && (
            <Card>
              <h3 className="section-title">API Keys</h3>
              <div className="space-y-4">
                <div className="p-4 rounded-lg border border-dark-border bg-dark-bg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-primary">Production API Key</span>
                    <StatusBadge status="success">Active</StatusBadge>
                  </div>
                  <code className="text-xs text-text-muted font-mono">
                    ey_prod_****************************************************************
                  </code>
                  <div className="flex gap-2 mt-3">
                    <button className="btn-ghost text-xs">Rotate Key</button>
                    <button className="btn-ghost text-xs">Copy</button>
                  </div>
                </div>
                <button className="btn-secondary text-sm">
                  <Key className="mr-2 h-4 w-4" />
                  Generate New API Key
                </button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
