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

const settingsSections = [
  { id: 'profile', name: 'Profile', icon: User },
  { id: 'security', name: 'Security', icon: Shield },
  { id: 'notifications', name: 'Notifications', icon: Bell },
  { id: 'appearance', name: 'Appearance', icon: Palette },
  { id: 'integrations', name: 'Integrations', icon: Globe },
  { id: 'build-type', name: 'Build Type', icon: Boxes },
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
