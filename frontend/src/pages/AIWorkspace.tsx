import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Upload,
  FileText,
  Link2,
  Send,
  FolderKanban,
  Clock,
  ChevronRight,
  Landmark,
  ShoppingCart,
  HeartPulse,
  Truck,
  ShieldCheck,
  Users,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { NewProjectWizard } from '../components/shared/NewProjectWizard';
import { useAuth } from '../lib/auth';
import { apiRequest, FASTAPI_BASE_URL } from '../lib/api';
import { mockProjectTemplates } from '../data/mockData';

const uploadOptions = [
  { id: 'brd', label: 'BRD Upload', icon: FileText, description: 'Business Requirements Document' },
  { id: 'rfp', label: 'RFP Upload', icon: FileText, description: 'Request for Proposal' },
  { id: 'pdf', label: 'PDF Upload', icon: FileText, description: 'Technical specifications' },
  { id: 'docx', label: 'DOCX Upload', icon: FileText, description: 'Microsoft Word Documents' },
  { id: 'jira', label: 'Jira Import', icon: Link2, description: 'Import from Jira' },
];

type GenerateAction = 'requirements' | 'userStories' | 'architecture';

type GenerateActionConfig = {
  label: string;
  endpoint: string;
  payload: (projectDescription: string, projectId: number) => Record<string, unknown>;
};

const generateActions: Record<GenerateAction, GenerateActionConfig> = {
  requirements: {
    label: 'Generate Requirements',
    endpoint: '/generate/requirements',
    payload: (projectDescription, projectId) => ({
      prompt: projectDescription,
      project_description: projectDescription,
      document_ids: [],
      project_id: projectId,
    }),
  },
  userStories: {
    label: 'Generate User Stories',
    endpoint: '/generate/user-stories',
    payload: (projectDescription, projectId) => ({
      project_description: projectDescription,
      project_id: projectId,
      requirements_artifact_id: null,
    }),
  },
  architecture: {
    label: 'Generate Architecture',
    endpoint: '/generate/architecture',
    payload: (projectDescription, projectId) => ({
      project_description: projectDescription,
      project_id: projectId,
    }),
  },
};

type ProjectResponse = {
  id: number;
  name: string;
  description: string | null;
};

type RecentProject = {
  id: number;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
};

export function AIWorkspace() {
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadingAction, setLoadingAction] = useState<GenerateAction | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState<{
    title: string;
    data: unknown;
  } | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectResponse | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadDocType, setUploadDocType] = useState<string>('brd');
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [recentProjectsError, setRecentProjectsError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    // This page is also the public landing route ("/"), reachable while
    // signed out — don't fire the request (and don't surface its 401 as a
    // scary error) until a session actually exists.
    if (!user) {
      setRecentProjects([]);
      setRecentProjectsError(null);
      return;
    }
    let active = true;
    apiRequest<{ projects?: RecentProject[] } | RecentProject[]>('/projects')
      .then((data) => {
        if (!active) return;
        const rows = Array.isArray(data) ? data : (Array.isArray(data?.projects) ? data.projects : []);
        setRecentProjects(
          [...rows]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 3)
        );
        setRecentProjectsError(null);
      })
      .catch((err) => {
        if (active) setRecentProjectsError(err instanceof Error ? err.message : 'Failed to load recent projects');
      });
    return () => { active = false; };
  }, [user]);

  const projectNameFromDescription = (projectDescription: string) => {
    const firstClause = projectDescription.split(/[.!?]/)[0]?.trim();
    return firstClause ? firstClause.slice(0, 80) : 'Autonomous SDLC Project';
  };

  const ensureProject = async (projectDescription: string) => {
    if (activeProject) {
      return activeProject;
    }

    const payload = {
      project_name: projectNameFromDescription(projectDescription),
      description: projectDescription,
      project_type: 'standalone_ai_generation',
      execution_mode: 'autonomous',
      build_type: 'full_stack',
      deliverables: ['SRS', 'User Stories', 'Architecture Documents', 'API Documents'],
      providers: {},
    };

    const project = await apiRequest<ProjectResponse>('/projects', {
      method: 'POST',
      body: payload,
    });
    setActiveProject(project);
    return project;
  };

  const openProjectWizard = () => {
    setGenerateError(null);
    setShowWizard(true);
  };

  const openFilePicker = (docType: string) => {
    setUploadDocType(docType);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setUploadingDoc(true);
    setGenerateError(null);
    try {
      // 1) Create the project (placeholder description; ingestion below folds
      //    the real extracted document text into it before the pipeline runs).
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const project = await apiRequest<ProjectResponse>('/projects', {
        method: 'POST',
        body: {
          project_name: baseName.slice(0, 80) || 'Uploaded Project',
          description: `Project created from uploaded document: ${file.name}`,
          project_type: 'standalone_ai_generation',
          execution_mode: 'autonomous',
          build_type: 'full_stack',
          deliverables: ['SRS', 'User Stories', 'Architecture Documents', 'API Documents'],
          providers: {},
        },
      });
      setActiveProject(project);

      // 2) Upload + ingest the document — the backend extracts PDF/DOCX text
      //    and folds it into the project description.
      const form = new FormData();
      form.append('project_id', String(project.id));
      form.append('document_type', uploadDocType);
      form.append('file', file);
      const ingestRes = await fetch(`${FASTAPI_BASE_URL}/ingestion/upload`, {
        method: 'POST', credentials: 'include', body: form,
      });
      if (!ingestRes.ok) {
        const detail = await ingestRes.json().catch(() => ({}));
        throw new Error(detail.detail || 'Document ingestion failed');
      }

      // 3) Launch the full autonomous pipeline against the ingested content.
      await apiRequest('/build/start', { method: 'POST', body: { project_id: project.id } });

      navigate('/app/dashboard', { state: { refresh: true, projectId: project.id } });
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : 'Document upload failed.');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleGenerate = async (action: GenerateAction) => {
    const projectDescription = prompt.trim();
    const config = generateActions[action];

    if (!projectDescription) {
      const message = 'Enter a project description before generating artifacts.';
      setGenerateError(message);
      return;
    }

    try {
      setLoadingAction(action);
      setGenerateError(null);
      const project = await ensureProject(projectDescription);
      const payload = config.payload(projectDescription, project.id);
      const data = await apiRequest<unknown>(config.endpoint, {
        method: 'POST',
        body: payload,
      });

      setGenerateResult({ title: config.label, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong while generating.';
      setGenerateError(message);
    } finally {
      setLoadingAction(null);
    }
  };

  const templateIcons: Record<string, React.ElementType> = {
    Landmark,
    ShoppingCart,
    HeartPulse,
    Truck,
    ShieldCheck,
    Users,
  };

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Header */}
      <header className="border-b border-dark-border bg-dark-card/50 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ey-yellow">
                <Zap className="h-6 w-6 text-dark-bg" />
              </div>
              <div>
                <span className="text-lg font-semibold text-text-primary">EY Autonomous SDLC Studio</span>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <button className="text-sm text-text-secondary hover:text-text-primary transition-colors">
                Documentation
              </button>
              <button className="text-sm text-text-secondary hover:text-text-primary transition-colors">
                Support
              </button>
              <button
                onClick={() => navigate(user ? '/app/dashboard' : '/signin')}
                className="btn-primary text-sm"
              >
                {user ? 'Go to Dashboard' : 'Sign In'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl px-6 py-16">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-ey-yellow/10 px-4 py-1.5">
            <Sparkles className="h-4 w-4 text-ey-yellow" />
            <span className="text-sm font-medium text-ey-yellow">AI-Powered Software Factory</span>
          </div>
          <h1 className="text-4xl font-bold text-text-primary md:text-5xl">
            Autonomous Software Delivery Platform
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
            Transform business requirements into production-ready systems through governed AI agent orchestration.
          </p>
        </motion.div>

        {/* AI Prompt Area */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-12"
        >
          <Card className="relative overflow-visible" glow>
            <div className="space-y-4">
              {/* Main Input */}
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onFocus={() => setIsExpanded(true)}
                  placeholder="Describe your project: e.g., Build a multi-tenant banking platform with KYC verification, fraud detection, customer onboarding, role-based access control, analytics dashboards, and PSD2 compliance..."
                  className="input-field h-40 w-full resize-none text-sm leading-relaxed"
                />
              </div>

              {/* Upload Options */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="grid grid-cols-5 gap-2 pt-2"
                  >
                    {uploadOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        disabled={uploadingDoc || option.id === 'jira'}
                        onClick={() => openFilePicker(option.id)}
                        title={option.id === 'jira' ? 'Use MCP Integration Center to connect Jira' : `Upload a ${option.label}`}
                        className="flex flex-col items-center gap-1 rounded-lg border border-dark-border p-3 text-center transition-all hover:border-ey-yellow/50 hover:bg-ey-yellow/5 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <option.icon className="h-5 w-5 text-text-secondary" />
                        <span className="text-xs font-medium text-text-primary">{option.label}</span>
                        <span className="text-[10px] text-text-muted">{option.description}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Actions */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md"
                className="hidden"
                onChange={handleFileSelected}
              />
              <div className="flex items-center justify-between border-t border-dark-border pt-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">
                    {uploadingDoc ? 'Uploading and ingesting document…' : 'Upload documents or describe requirements'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={uploadingDoc} onClick={() => openFilePicker('pdf')}
                    className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50">
                    <Upload className="mr-2 h-4 w-4" />
                    {uploadingDoc ? 'Uploading…' : 'Upload'}
                  </button>
                  <button onClick={openProjectWizard} className="btn-primary text-sm">
                    <Send className="mr-2 h-4 w-4" />
                    Start Autonomous Build
                  </button>
                </div>
              </div>
            </div>
          </Card>

          {/* Quick Actions */}
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => handleGenerate('requirements')}
              disabled={loadingAction !== null}
              className="btn-ghost text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileText className="mr-2 h-4 w-4" />
              {loadingAction === 'requirements' ? 'Generating...' : 'Generate Requirements'}
            </button>
            <button
              onClick={() => handleGenerate('userStories')}
              disabled={loadingAction !== null}
              className="btn-ghost text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FolderKanban className="mr-2 h-4 w-4" />
              {loadingAction === 'userStories' ? 'Generating...' : 'Generate User Stories'}
            </button>
            <button
              onClick={() => handleGenerate('architecture')}
              disabled={loadingAction !== null}
              className="btn-ghost text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Zap className="mr-2 h-4 w-4" />
              {loadingAction === 'architecture' ? 'Generating...' : 'Generate Architecture'}
            </button>
          </div>
          {generateError && (
            <p className="mt-3 text-center text-sm text-status-error">
              {generateError}
            </p>
          )}
        </motion.div>

        {/* Recent Projects */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-16"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-text-primary">Recent Projects</h2>
            <button
              onClick={() => navigate('/app/projects')}
              className="flex items-center gap-1 text-sm text-text-secondary hover:text-ey-yellow transition-colors"
            >
              View All
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {!user && (
            <p className="mb-4 text-sm text-text-muted">
              <button onClick={() => navigate('/signin')} className="text-ey-yellow hover:underline">Sign in</button> to see your recent projects.
            </p>
          )}
          {user && recentProjectsError && (
            <p className="mb-4 text-sm text-status-error">{recentProjectsError}</p>
          )}
          {user && !recentProjectsError && recentProjects.length === 0 && (
            <p className="mb-4 text-sm text-text-muted">No projects yet — create one above to get started.</p>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {recentProjects.map((project) => (
              <Card
                key={project.id}
                hover
                onClick={() => navigate('/app/dashboard')}
                className="cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-text-primary">{project.name}</h3>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          project.status === 'in_progress'
                            ? 'bg-status-success'
                            : project.status === 'completed'
                              ? 'bg-status-info'
                              : 'bg-text-muted'
                        }`}
                      />
                    </div>
                    <p className="mt-1 text-xs text-text-muted line-clamp-2">{project.description}</p>
                  </div>
                  <span className="text-xs capitalize text-text-muted">{project.status.replace('_', ' ')}</span>
                </div>
                <div className="mt-4 flex items-center gap-3 text-xs text-text-muted">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(project.created_at).toLocaleDateString()}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </motion.div>

        {/* Templates */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-16"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Project Templates</h2>
              <p className="mt-1 text-sm text-text-muted">Start from pre-configured industry templates</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {mockProjectTemplates.map((template) => {
              const Icon = templateIcons[template.icon] || Landmark;
              return (
                <Card
                  key={template.id}
                  hover
                  className="group cursor-pointer"
                  onClick={() => {
                    setPrompt(`Build a ${template.name.toLowerCase()} - ${template.description}`);
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-ey-yellow/10 text-ey-yellow transition-colors group-hover:bg-ey-yellow group-hover:text-dark-bg">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-text-primary">{template.name}</h3>
                      <p className="mt-1 text-xs text-text-muted">{template.description}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-dark-border transition-all group-hover:translate-x-1 group-hover:text-ey-yellow" />
                  </div>
                </Card>
              );
            })}
          </div>
        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-16 border-t border-dark-border pt-16"
        >
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-text-primary">Enterprise-Grade AI Software Factory</h2>
            <p className="mt-2 text-text-secondary">Complete visibility, governance, and auditability at every stage</p>
          </div>
          <div className="grid gap-6 md:grid-cols-4">
            {[
              { title: 'Autonomous Agents', desc: '10 specialized AI agents working in concert', icon: Zap },
              { title: 'Full Governance', desc: 'Human-in-the-loop approvals at every stage', icon: ShieldCheck },
              { title: 'Complete Audit', desc: 'Temporal replay of every decision and action', icon: Clock },
              { title: 'Enterprise Ready', desc: 'SOC2 compliant, SSO, RBAC built-in', icon: Landmark },
            ].map((feature) => (
              <div key={feature.title} className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-dark-card">
                  <feature.icon className="h-6 w-6 text-ey-yellow" />
                </div>
                <h3 className="font-medium text-text-primary">{feature.title}</h3>
                <p className="mt-1 text-xs text-text-muted">{feature.desc}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </main>

      <AnimatePresence>
        {generateResult && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-dark-bg/80 px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-3xl rounded-lg border border-dark-border bg-dark-card p-6 shadow-xl"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text-primary">{generateResult.title}</h2>
                <button
                  onClick={() => setGenerateResult(null)}
                  className="text-sm text-text-secondary transition-colors hover:text-text-primary"
                >
                  Close
                </button>
              </div>
              <pre className="max-h-[60vh] overflow-auto rounded-lg border border-dark-border bg-dark-bg p-4 text-xs text-text-secondary">
                {JSON.stringify(generateResult.data, null, 2)}
              </pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <NewProjectWizard isOpen={showWizard} onClose={() => setShowWizard(false)} />
    </div>
  );
}
