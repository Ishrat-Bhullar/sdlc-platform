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
import { getSelectedProjectId } from '../lib/projectContext';
import { useEffect } from 'react';

interface PlatformDefaultStatus {
  azure_configured: boolean;
  azure_model: string | null;
  azure_endpoint: string | null;
  openai_configured: boolean;
  openai_model: string | null;
  default_configured: boolean;
  default_provider: string | null;
  default_model: string | null;
  default_base_url: string | null;
  ollama_reachable: boolean;
}

interface ProviderConfigRow {
  id: number;
  project_id: number;
  provider_name: string;
  enabled: boolean;
  base_url: string | null;
  model: string | null;
  api_version: string | null;
}

function toBackendProviderName(id: string): string {
  return id.replace(/-/g, '_');
}

/** Single "AI Provider" panel: a read-only Platform Default status card
 * (set by the deployment's env config — see backend/.env.example) plus a
 * functional per-project BYOK card. Resolution order used by every AI call
 * across the platform: a project's own enabled BYOK key wins if present,
 * otherwise the Platform Default is used, otherwise Ollama is the
 * transparent fallback. */
function AIProviderSettings() {
  const projectId = getSelectedProjectId();

  const [platformStatus, setPlatformStatus] = useState<PlatformDefaultStatus | null>(null);
  const [testingDefault, setTestingDefault] = useState(false);
  const [defaultTestResult, setDefaultTestResult] = useState<string | null>(null);
  const [defaultTestOk, setDefaultTestOk] = useState(false);

  useEffect(() => {
    fastApiRequest<PlatformDefaultStatus>('/settings/ai-config')
      .then(setPlatformStatus)
      .catch(() => setPlatformStatus({
        azure_configured: false, azure_model: null, azure_endpoint: null,
        openai_configured: false, openai_model: null,
        default_configured: false, default_provider: null, default_model: null,
        default_base_url: null, ollama_reachable: false,
      }));
  }, []);

  const testDefault = async () => {
    setTestingDefault(true); setDefaultTestResult(null);
    try {
      const r = await fastApiRequest<{ reachable: boolean; message: string }>(
        '/settings/ai-config/test', { method: 'POST' });
      setDefaultTestOk(r.reachable); setDefaultTestResult(r.message);
    } catch {
      setDefaultTestOk(false); setDefaultTestResult('Could not reach the platform default provider.');
    }
    setTestingDefault(false);
  };

  const [byokKeys, setByokKeys] = useState<Record<string, string>>({});
  const [byokEnabled, setByokEnabled] = useState<Record<string, boolean>>({});
  const [byokBaseUrl, setByokBaseUrl] = useState<Record<string, string>>({});
  const [byokModel, setByokModel] = useState<Record<string, string>>({});
  const [byokApiVersion, setByokApiVersion] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [providerMessages, setProviderMessages] = useState<Record<string, { ok: boolean; text: string }>>({});

  useEffect(() => {
    if (!projectId) return;
    fastApiRequest<{ providers: ProviderConfigRow[] }>(`/providers?project_id=${projectId}`)
      .then((data) => {
        const enabled: Record<string, boolean> = {};
        const baseUrl: Record<string, string> = {};
        const model: Record<string, string> = {};
        const apiVersion: Record<string, string> = {};
        for (const row of data.providers || []) {
          const feId = row.provider_name.replace(/_/g, '-');
          enabled[feId] = row.enabled;
          if (row.base_url) baseUrl[feId] = row.base_url;
          if (row.model) model[feId] = row.model;
          if (row.api_version) apiVersion[feId] = row.api_version;
        }
        setByokEnabled(enabled);
        setByokBaseUrl(baseUrl);
        setByokModel(model);
        setByokApiVersion(apiVersion);
      })
      .catch(() => { /* no BYOK configured yet for this project */ });
  }, [projectId]);

  const saveProvider = async (id: string) => {
    if (!projectId) return;
    setSavingProvider(id);
    setProviderMessages((prev) => ({ ...prev, [id]: { ok: true, text: '' } }));
    try {
      await fastApiRequest('/providers/configure', {
        method: 'POST',
        body: {
          project_id: Number(projectId),
          provider_name: toBackendProviderName(id),
          api_key: byokKeys[id] || '',
          enabled: byokEnabled[id] || false,
          base_url: byokBaseUrl[id] || null,
          model: byokModel[id] || null,
          api_version: byokApiVersion[id] || null,
        },
      });
      setProviderMessages((prev) => ({ ...prev, [id]: { ok: true, text: 'Saved — this key will now be used for every AI call in this project.' } }));
    } catch (err) {
      setProviderMessages((prev) => ({ ...prev, [id]: { ok: false, text: err instanceof Error ? err.message : 'Save failed.' } }));
    }
    setSavingProvider(null);
  };

  const testProvider = async (id: string) => {
    if (!projectId) return;
    setTestingProvider(id);
    try {
      const r = await fastApiRequest<{ reachable: boolean; message: string }>('/providers/test', {
        method: 'POST',
        body: { project_id: Number(projectId), provider_name: toBackendProviderName(id) },
      });
      setProviderMessages((prev) => ({ ...prev, [id]: { ok: r.reachable, text: r.message } }));
    } catch (err) {
      setProviderMessages((prev) => ({ ...prev, [id]: { ok: false, text: err instanceof Error ? err.message : 'Test failed.' } }));
    }
    setTestingProvider(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="section-title">Platform Default</h3>
        <p className="text-xs text-text-muted mb-4">
          Configured once by your deployment administrator directly in the backend's{' '}
          <code className="font-mono text-[11px]">backend/.env</code> file — there is no key input on this page by
          design. Resolution order for every AI call in the platform: Azure key first, then the OpenAI (GPT) key if
          Azure isn't set, then local Ollama only if neither key below is configured. Any project's own BYOK key
          (below) always overrides both of these.
        </p>
        {platformStatus ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-dark-bg">
              <div className="flex items-center gap-2">
                <Cloud className={`h-4 w-4 ${platformStatus.azure_configured ? 'text-ey-yellow' : 'text-text-muted'}`} />
                <div>
                  <span className="text-sm text-text-primary">
                    Azure OpenAI {platformStatus.azure_configured ? `· ${platformStatus.azure_model}` : ''}
                  </span>
                  <p className="text-[10px] text-text-muted">Set via <code className="font-mono">DEFAULT_AZURE_OPENAI_*</code> in backend/.env — tried 1st</p>
                </div>
              </div>
              <StatusBadge status={platformStatus.azure_configured ? 'success' : 'idle'}>
                {platformStatus.azure_configured ? 'Configured' : 'Not configured'}
              </StatusBadge>
            </div>
            {platformStatus.azure_endpoint && (
              <p className="text-[11px] text-text-muted font-mono px-1 -mt-2">{platformStatus.azure_endpoint}</p>
            )}
            <div className="flex items-center justify-between p-3 rounded-lg bg-dark-bg">
              <div className="flex items-center gap-2">
                <Cloud className={`h-4 w-4 ${platformStatus.openai_configured ? 'text-ey-yellow' : 'text-text-muted'}`} />
                <div>
                  <span className="text-sm text-text-primary">
                    OpenAI (GPT) {platformStatus.openai_configured ? `· ${platformStatus.openai_model}` : ''}
                  </span>
                  <p className="text-[10px] text-text-muted">Set via <code className="font-mono">DEFAULT_OPENAI_*</code> in backend/.env — tried 2nd, only if Azure is blank</p>
                </div>
              </div>
              <StatusBadge status={platformStatus.openai_configured ? 'success' : 'idle'}>
                {platformStatus.openai_configured ? 'Configured' : 'Not configured'}
              </StatusBadge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-dark-bg">
              <div>
                <span className="text-sm text-text-primary">Ollama fallback</span>
                <p className="text-[10px] text-text-muted">
                  {platformStatus.azure_configured || platformStatus.openai_configured
                    ? 'Not used — a cloud key above is configured'
                    : 'Used only because no cloud key is configured above'}
                </p>
              </div>
              <StatusBadge status={platformStatus.ollama_reachable ? 'success' : 'idle'}>
                {platformStatus.ollama_reachable ? 'Reachable' : 'Unreachable'}
              </StatusBadge>
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-muted">Loading…</p>
        )}
        {platformStatus?.default_configured && (
          <div className="mt-4">
            <button onClick={testDefault} disabled={testingDefault}
              className="flex items-center gap-2 rounded-lg border border-dark-border px-4 py-2 text-sm font-medium text-text-secondary hover:border-ey-yellow/40 disabled:opacity-50">
              {testingDefault ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              Test Connection
            </button>
            {defaultTestResult && (
              <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${defaultTestOk ? 'border-status-success/30 bg-status-success/5 text-status-success' : 'border-status-error/30 bg-status-error/5 text-status-error'}`}>
                {defaultTestOk ? <Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> : null}
                <span>{defaultTestResult}</span>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="section-title">Your API Keys (BYOK)</h3>
        <p className="text-xs text-text-muted mb-4">
          Bring your own key for this project. When enabled, your key takes priority over the Platform Default
          for every AI generation in this project. Keys are encrypted at rest and never displayed again after saving.
        </p>
        {!projectId && (
          <div className="mb-3 rounded-lg border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-status-warning">
            Select a project first to configure per-project API keys.
          </div>
        )}
        <div className="space-y-3">
          {byokProviders.map((provider) => {
            const isEnabled = byokEnabled[provider.id] || false;
            const msg = providerMessages[provider.id];
            return (
              <div key={provider.id} className={`rounded-lg border p-4 transition-all ${isEnabled ? 'border-ey-yellow/30 bg-ey-yellow/5' : 'border-dark-border bg-dark-bg'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Cloud className={`h-4 w-4 ${isEnabled ? 'text-ey-yellow' : 'text-text-muted'}`} />
                    <span className="text-sm font-medium text-text-primary">{provider.name}</span>
                    {isEnabled && <StatusBadge status="success">Enabled</StatusBadge>}
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      disabled={!projectId}
                      onChange={(e) => setByokEnabled((prev) => ({ ...prev, [provider.id]: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 rounded-full bg-dark-border peer-checked:bg-ey-yellow after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type={visibleKeys[provider.id] ? 'text' : 'password'}
                    value={byokKeys[provider.id] || ''}
                    onChange={(e) => setByokKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                    placeholder={provider.placeholder}
                    disabled={!isEnabled || !projectId}
                    className="input-field flex-1 font-mono text-xs"
                  />
                  <button
                    onClick={() => setVisibleKeys((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                    disabled={!isEnabled}
                    className="rounded-lg border border-dark-border bg-dark-card p-2 text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
                  >
                    {visibleKeys[provider.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-text-muted mt-1">{provider.keyLabel}</p>

                {provider.needsEndpoint && isEnabled && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div>
                      <input
                        type="text"
                        value={byokBaseUrl[provider.id] || ''}
                        onChange={(e) => setByokBaseUrl((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                        placeholder={provider.id === 'azure-openai' ? 'https://<resource>.openai.azure.com' : 'https://your-endpoint/v1'}
                        className="input-field w-full text-xs"
                      />
                      <p className="text-[10px] text-text-muted mt-1">Base URL / Endpoint</p>
                    </div>
                    <div>
                      <input
                        type="text"
                        value={byokModel[provider.id] || ''}
                        onChange={(e) => setByokModel((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                        placeholder={provider.id === 'azure-openai' ? 'Deployment name' : 'Model name'}
                        className="input-field w-full text-xs"
                      />
                      <p className="text-[10px] text-text-muted mt-1">{provider.id === 'azure-openai' ? 'Deployment Name' : 'Model'}</p>
                    </div>
                    {provider.id === 'azure-openai' && (
                      <div className="col-span-2">
                        <input
                          type="text"
                          value={byokApiVersion[provider.id] || ''}
                          onChange={(e) => setByokApiVersion((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                          placeholder="2024-06-01"
                          className="input-field w-full text-xs"
                        />
                        <p className="text-[10px] text-text-muted mt-1">API Version</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => saveProvider(provider.id)}
                    disabled={!isEnabled || !byokKeys[provider.id] || !projectId || savingProvider === provider.id}
                    className="flex items-center gap-1.5 rounded-lg bg-ey-yellow/20 px-3 py-1.5 text-xs text-ey-yellow hover:bg-ey-yellow/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingProvider === provider.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Save
                  </button>
                  <button
                    onClick={() => testProvider(provider.id)}
                    disabled={!isEnabled || !projectId || testingProvider === provider.id}
                    className="flex items-center gap-1.5 rounded-lg border border-dark-border px-3 py-1.5 text-xs text-text-secondary hover:border-ey-yellow/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testingProvider === provider.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                    Test
                  </button>
                </div>
                {msg?.text && (
                  <div className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${msg.ok ? 'border-status-success/30 bg-status-success/5 text-status-success' : 'border-status-error/30 bg-status-error/5 text-status-error'}`}>
                    {msg.ok ? <Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> : null}
                    <span>{msg.text}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

const settingsSections = [
  { id: 'profile', name: 'Profile', icon: User },
  { id: 'security', name: 'Security', icon: Shield },
  { id: 'notifications', name: 'Notifications', icon: Bell },
  { id: 'appearance', name: 'Appearance', icon: Palette },
  { id: 'integrations', name: 'Integrations', icon: Globe },
  { id: 'build-type', name: 'Build Type', icon: Boxes },
  { id: 'ai-provider', name: 'AI Provider', icon: Cloud },
  { id: 'api', name: 'API Keys', icon: Key },
];

const buildTypes = [
  { id: 'open-source', name: 'Open Source', description: 'Publicly accessible, community-driven projects', icon: Globe },
  { id: 'private-enterprise', name: 'Private Enterprise', description: 'Proprietary enterprise applications with restricted access', icon: Lock },
  { id: 'internal-organization', name: 'Internal Organization', description: 'Internal tools and platforms for organizational use', icon: Boxes },
];

const byokProviders = [
  { id: 'openai', name: 'OpenAI', keyLabel: 'OpenAI API Key', placeholder: 'sk-...', needsEndpoint: false },
  { id: 'anthropic', name: 'Anthropic', keyLabel: 'Anthropic API Key', placeholder: 'sk-ant-...', needsEndpoint: false },
  { id: 'gemini', name: 'Gemini', keyLabel: 'Gemini API Key', placeholder: 'AIza...', needsEndpoint: false },
  { id: 'groq', name: 'Groq', keyLabel: 'Groq API Key (fast/cheap dev provider)', placeholder: 'gsk_...', needsEndpoint: false },
  { id: 'azure-openai', name: 'Azure OpenAI', keyLabel: 'Azure OpenAI Key', placeholder: 'Azure key...', needsEndpoint: true },
  { id: 'aws-bedrock', name: 'AWS Bedrock', keyLabel: 'AWS Bedrock Key', placeholder: 'AKIA...', needsEndpoint: false },
  { id: 'openai-compatible', name: 'OpenAI-Compatible', keyLabel: 'API Key', placeholder: 'Bearer token or API key', needsEndpoint: true },
  { id: 'd-id', name: 'D-ID Avatar', keyLabel: 'D-ID credential (email:api_key format, exactly as D-ID issues it)', placeholder: 'you@email.com:your-api-key', needsEndpoint: false },
];
// Ollama is a managed fallback, not a per-project BYOK credential — its
// status is shown in the Platform Default card instead of a key input here.

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

          {activeSection === 'ai-provider' && <AIProviderSettings />}

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
