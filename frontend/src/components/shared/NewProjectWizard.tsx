import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  FileText,
  Building2,
  Database,
  Monitor,
  Server,
  TestTube,
  Rocket,
  Code,
  Briefcase,
  Zap,
  Boxes,
  Lock,
  FileCheck,
  Cloud,
  Eye,
  EyeOff,
  MessageSquare,
  Bot,
  Smartphone,
  Globe,
  Workflow,
  Layers,
  FileCog,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { apiRequest } from '../../lib/api';

interface NewProjectWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

const projectTypes = [
  { id: 'rag-chatbot', name: 'RAG Chatbot', icon: MessageSquare, description: 'Retrieval-augmented generation chatbot' },
  { id: 'ai-agent-platform', name: 'AI Agent Platform', icon: Bot, description: 'Multi-agent orchestration platform' },
  { id: 'web-app', name: 'Web App', icon: Monitor, description: 'Frontend + Backend + Database' },
  { id: 'mobile-app', name: 'Mobile App', icon: Smartphone, description: 'iOS + Android + API' },
  { id: 'enterprise-portal', name: 'Enterprise Portal', icon: Briefcase, description: 'Large-scale enterprise portal' },
  { id: 'microservices', name: 'Microservices Platform', icon: Boxes, description: 'Service-oriented architecture' },
  { id: 'api-service', name: 'API Service', icon: Server, description: 'REST/GraphQL backend service' },
  { id: 'data-platform', name: 'Data Platform', icon: Database, description: 'Analytics & reporting pipeline' },
  { id: 'fullstack-platform', name: 'Full Stack Platform', icon: Layers, description: 'End-to-end enterprise system' },
  { id: 'custom-project', name: 'Custom Project', icon: FileCog, description: 'Define your own project scope' },
];

const executionModes = [
  {
    id: 'auto' as const,
    name: 'Auto',
    icon: Zap,
    description: 'AI agents autonomously execute the full SDLC pipeline. All deliverables are generated automatically with governance checkpoints.',
  },
  {
    id: 'manual' as const,
    name: 'Manual',
    icon: FileCheck,
    description: 'Choose specific deliverables to generate. Full control over which SDLC stages AI agents execute.',
  },
  {
    id: 'hybrid' as const,
    name: 'Hybrid',
    icon: Workflow,
    description: 'Select manual stages to control, remaining stages run automatically. Best of both worlds.',
  },
];

const deliverableCategories = [
  {
    id: 'business',
    name: 'Business',
    icon: Briefcase,
    deliverables: [
      { id: 'brd', name: 'BRD', description: 'Business Requirements Document' },
      { id: 'frs', name: 'FRS', description: 'Functional Requirements Specification' },
      { id: 'srs', name: 'SRS', description: 'Software Requirements Specification' },
      { id: 'user-stories', name: 'User Stories', description: 'Epics with acceptance criteria' },
    ],
  },
  {
    id: 'architecture',
    name: 'Architecture',
    icon: Building2,
    deliverables: [
      { id: 'solution-architecture', name: 'Solution Architecture', description: 'Overall solution design document' },
      { id: 'hld', name: 'HLD', description: 'High-Level Design' },
      { id: 'lld', name: 'LLD', description: 'Low-Level Design' },
      { id: 'workflow-diagrams', name: 'Workflow Diagrams', description: 'Process & workflow diagrams' },
      { id: 'system-diagrams', name: 'System Diagrams', description: 'Component & deployment diagrams' },
    ],
  },
  {
    id: 'database',
    name: 'Database',
    icon: Database,
    deliverables: [
      { id: 'erd', name: 'ERD', description: 'Entity-Relationship Diagram' },
      { id: 'schema', name: 'Schema', description: 'Database schema definition' },
      { id: 'sql-scripts', name: 'SQL Scripts', description: 'Migration & seed scripts' },
    ],
  },
  {
    id: 'development',
    name: 'Development',
    icon: Code,
    deliverables: [
      { id: 'frontend', name: 'Frontend', description: 'UI components & pages' },
      { id: 'backend', name: 'Backend', description: 'Services & business logic' },
      { id: 'api-design', name: 'API Design', description: 'OpenAPI / GraphQL specs' },
    ],
  },
  {
    id: 'quality',
    name: 'Quality',
    icon: TestTube,
    deliverables: [
      { id: 'testing', name: 'Testing', description: 'Unit, integration, E2E tests' },
      { id: 'security-review', name: 'Security Review', description: 'Security audit & compliance' },
      { id: 'code-review', name: 'Code Review', description: 'Automated code quality review' },
    ],
  },
  {
    id: 'operations',
    name: 'Operations',
    icon: Rocket,
    deliverables: [
      { id: 'devops', name: 'DevOps', description: 'CI/CD pipeline & infrastructure' },
      { id: 'deployment', name: 'Deployment', description: 'Deployment configs & runbooks' },
      { id: 'documentation', name: 'Documentation', description: 'Technical & user documentation' },
    ],
  },
];

const allDeliverableIds = deliverableCategories.flatMap((c) => c.deliverables.map((d) => d.id));
const allStageIds = [...allDeliverableIds];

const buildTypes = [
  { id: 'open-source', name: 'Open Source', icon: Globe, description: 'Publicly accessible, community-driven projects' },
  { id: 'private-enterprise', name: 'Private Enterprise', icon: Lock, description: 'Proprietary enterprise applications' },
  { id: 'internal-organization', name: 'Internal Organization', icon: Boxes, description: 'Internal tools and platforms' },
];

const byokProviders = [
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...' },
  { id: 'gemini', name: 'Gemini', placeholder: 'AIza...' },
  { id: 'azure-openai', name: 'Azure OpenAI', placeholder: 'Azure key...' },
  { id: 'aws-bedrock', name: 'AWS Bedrock', placeholder: 'AKIA...' },
  { id: 'ollama', name: 'Ollama', placeholder: 'http://localhost:11434' },
];

const deliverableMap: Record<string, string> = {
  brd: 'BRD',
  frs: 'SRS',
  srs: 'SRS',
  'user-stories': 'User Stories',
  'solution-architecture': 'Architecture Documents',
  hld: 'Architecture Documents',
  lld: 'Architecture Documents',
  'workflow-diagrams': 'Architecture Documents',
  'system-diagrams': 'Architecture Documents',
  erd: 'Database Documents',
  schema: 'Database Documents',
  'sql-scripts': 'Database Documents',
  frontend: 'API Documents',
  backend: 'API Documents',
  'api-design': 'API Documents',
  testing: 'Test Reports',
  'security-review': 'Test Reports',
  'code-review': 'Test Reports',
  devops: 'Deployment Documents',
  deployment: 'Deployment Documents',
  documentation: 'Deployment Documents',
};

const providerMap: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
  'azure-openai': 'azure_openai',
  'aws-bedrock': 'aws_bedrock',
  ollama: 'ollama',
};

const steps = [
  { id: 0, name: 'Project Details', icon: FileText },
  { id: 1, name: 'Project Type', icon: Boxes },
  { id: 2, name: 'Execution Mode', icon: Zap },
  { id: 3, name: 'Deliverables', icon: FileCheck },
  { id: 4, name: 'Build & BYOK', icon: Cloud },
  { id: 5, name: 'Review & Launch', icon: Rocket },
];

function getStepDestination(mode: string | null, step: number): number {
  if (mode === 'auto' && step === 3) return 4;
  return step + 1;
}

function getBackDestination(mode: string | null, step: number): number {
  if (mode === 'auto' && step === 4) return 2;
  return step - 1;
}

export function NewProjectWizard({ isOpen, onClose }: NewProjectWizardProps) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectType, setProjectType] = useState<string | null>(null);
  const [executionMode, setExecutionMode] = useState<'auto' | 'manual' | 'hybrid' | null>(null);
  const [selectedDeliverables, setSelectedDeliverables] = useState<string[]>([]);
  const [manualStages, setManualStages] = useState<string[]>([]);
  const [buildType, setBuildType] = useState<string>('private-enterprise');
  const [providerSettings, setProviderSettings] = useState<Record<string, { enabled: boolean; keySource: 'platform' | 'user' }>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  const resetWizard = () => {
    setCurrentStep(0);
    setProjectName('');
    setProjectDescription('');
    setProjectType(null);
    setExecutionMode(null);
    setSelectedDeliverables([]);
    setManualStages([]);
    setBuildType('private-enterprise');
    setProviderSettings({});
    setApiKeys({});
    setVisibleKeys({});
    setSaving(false);
    setLaunchError(null);
  };

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  const toggleDeliverable = (id: string) => {
    setSelectedDeliverables((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const toggleManualStage = (id: string) => {
    setManualStages((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const toggleProvider = (id: string) => {
    setProviderSettings((prev) => ({
      ...prev,
      [id]: prev[id]?.enabled
        ? { enabled: false, keySource: prev[id].keySource }
        : { enabled: true, keySource: 'platform' },
    }));
  };

  const allDeliverablesForMode = executionMode === 'manual' || executionMode === 'hybrid';

  const deliverablesToShow = executionMode === 'hybrid'
    ? allDeliverableIds
    : selectedDeliverables;

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return projectName.trim().length > 0;
      case 1:
        return projectType !== null;
      case 2:
        return executionMode !== null;
      case 3:
        if (executionMode === 'auto') return true;
        if (executionMode === 'manual') return selectedDeliverables.length > 0;
        if (executionMode === 'hybrid') return manualStages.length > 0;
        return false;
      case 4:
        return true;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(getStepDestination(executionMode, currentStep));
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(getBackDestination(executionMode, currentStep));
    }
  };

  const handleLaunch = async () => {
    setSaving(true);
    setLaunchError(null);
    const providerPayload: Record<string, string> = {};
    Object.entries(providerSettings).forEach(([k, v]) => {
      const backendProvider = providerMap[k];
      const apiKey = apiKeys[k]?.trim();
      if (v.enabled && backendProvider && v.keySource === 'user' && apiKey) {
        providerPayload[backendProvider] = apiKey;
      }
    });

    try {
      const selectedIds =
        executionMode === 'auto'
          ? allDeliverableIds
          : executionMode === 'hybrid'
            ? allDeliverableIds
            : selectedDeliverables;
      const deliverables = Array.from(
        new Set(selectedIds.map((id) => deliverableMap[id]).filter(Boolean))
      );

      const project = await apiRequest<{ id: number }>('/projects', {
        method: 'POST',
        body: {
          project_name: projectName.trim(),
          description: projectDescription.trim(),
          project_type: projectType === 'custom-project'
            ? 'standalone_ai_generation'
            : 'project_based_sdlc',
          execution_mode: executionMode === 'auto' ? 'autonomous' : 'assisted',
          build_type: 'full_stack',
          deliverables,
          providers: providerPayload,
          manual_stages: manualStages,
          launch_mode: executionMode,
          build_profile: buildType,
        },
      });
      await apiRequest('/build/start', {
        method: 'POST',
        body: { project_id: project.id },
      });

      handleClose();
      navigate('/app/dashboard', { state: { refresh: true, projectId: project.id } });
    } catch (error) {
      setSaving(false);
      setLaunchError(error instanceof Error ? error.message : 'Project launch failed.');
    }
  };

  const selectedType = projectTypes.find((t) => t.id === projectType);
  const selectedMode = executionModes.find((m) => m.id === executionMode);
  const selectedBuildType = buildTypes.find((b) => b.id === buildType);
  const skippedSteps = executionMode === 'auto' ? [3] : [];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-dark-bg/80 backdrop-blur-sm p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-dark-card border border-dark-border rounded-lg w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-dark-border px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ey-yellow">
                  <Zap className="h-5 w-5 text-dark-bg" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">New Project Wizard</h2>
                  <p className="text-xs text-text-muted">Create a new autonomous SDLC project</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="rounded-lg p-2 text-text-muted hover:bg-dark-bg hover:text-text-primary transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Step Progress Bar */}
            <div className="border-b border-dark-border px-6 py-4">
              <div className="flex items-center justify-between">
                {steps.map((step, index) => {
                  const StepIcon = step.icon;
                  const isSkipped = skippedSteps.includes(index);
                  const isCompleted = index < currentStep || isSkipped;
                  const isCurrent = index === currentStep;
                  const visible = !isSkipped || index < currentStep;
                  if (!visible && index !== currentStep) return null;
                  return (
                    <div key={step.id} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                            isCompleted || isSkipped
                              ? 'border-status-success bg-status-success/10'
                              : isCurrent
                                ? 'border-ey-yellow bg-ey-yellow/10'
                                : 'border-dark-border bg-dark-bg'
                          }`}
                        >
                          {isCompleted || isSkipped ? (
                            <Check className="h-4 w-4 text-status-success" />
                          ) : (
                            <StepIcon className={`h-4 w-4 ${isCurrent ? 'text-ey-yellow' : 'text-text-muted'}`} />
                          )}
                        </div>
                        <span className={`text-[10px] whitespace-nowrap ${isCurrent ? 'text-ey-yellow font-medium' : isCompleted || isSkipped ? 'text-status-success' : 'text-text-muted'}`}>
                          {step.name}
                        </span>
                      </div>
                      {index < steps.length - 1 && (
                        <div
                          className={`h-0.5 flex-1 mx-2 mb-4 transition-all ${
                            index < currentStep ? 'bg-status-success' : 'bg-dark-border'
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {/* Step 0: Project Name & Description */}
              {currentStep === 0 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-text-primary mb-2 block">Project Name</label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="e.g., Multi-Tenant Banking Platform"
                      className="input-field w-full"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text-primary mb-2 block">Project Description</label>
                    <textarea
                      value={projectDescription}
                      onChange={(e) => setProjectDescription(e.target.value)}
                      placeholder="Describe your project goals and scope..."
                      className="input-field w-full h-24 resize-none"
                    />
                  </div>
                </motion.div>
              )}

              {/* Step 1: Project Type */}
              {currentStep === 1 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                  <p className="text-sm font-medium text-text-primary mb-4">Select Project Type</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {projectTypes.map((type) => {
                      const Icon = type.icon;
                      const isSelected = projectType === type.id;
                      return (
                        <button
                          key={type.id}
                          onClick={() => setProjectType(type.id)}
                          className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-all ${
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
                          {isSelected && <Check className="h-4 w-4 text-ey-yellow flex-shrink-0 mt-1" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Step 2: Execution Mode */}
              {currentStep === 2 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                  <p className="text-sm font-medium text-text-primary mb-4">Select Execution Mode</p>
                  <div className="grid gap-4 md:grid-cols-3">
                    {executionModes.map((mode) => {
                      const Icon = mode.icon;
                      const isSelected = executionMode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => setExecutionMode(mode.id)}
                          className={`flex flex-col items-start gap-3 rounded-lg border p-5 text-left transition-all ${
                            isSelected
                              ? 'border-ey-yellow bg-ey-yellow/10'
                              : 'border-dark-border bg-dark-bg hover:border-dark-border-light'
                          }`}
                        >
                          <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${isSelected ? 'bg-ey-yellow/20' : 'bg-dark-card'}`}>
                            <Icon className={`h-6 w-6 ${isSelected ? 'text-ey-yellow' : 'text-text-secondary'}`} />
                          </div>
                          <div>
                            <p className={`text-sm font-semibold ${isSelected ? 'text-ey-yellow' : 'text-text-primary'}`}>{mode.name}</p>
                            <p className="text-xs text-text-muted mt-1">{mode.description}</p>
                          </div>
                          {isSelected && <Check className="h-4 w-4 text-ey-yellow flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Step 3: Deliverables (manual/hybrid) */}
              {currentStep === 3 && allDeliverablesForMode && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                  {executionMode === 'hybrid' && (
                    <div className="mb-4 rounded-lg border border-status-info/30 bg-status-info/5 p-3">
                      <p className="text-xs text-status-info">
                        Select stages to control manually. Remaining stages will run automatically.
                      </p>
                    </div>
                  )}
                  <p className="text-sm font-medium text-text-primary mb-3">
                    {executionMode === 'hybrid' ? 'Select Manual Stages' : 'Select Deliverables'}
                  </p>
                  <div className="space-y-4">
                    {deliverableCategories.map((category) => {
                      const CatIcon = category.icon;
                      return (
                        <div key={category.id}>
                          <div className="flex items-center gap-2 mb-2">
                            <CatIcon className="h-4 w-4 text-ey-yellow" />
                            <span className="text-xs font-semibold text-text-primary">{category.name}</span>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            {category.deliverables.map((deliverable) => {
                              const isSelected = executionMode === 'hybrid'
                                ? manualStages.includes(deliverable.id)
                                : selectedDeliverables.includes(deliverable.id);
                              const toggle = executionMode === 'hybrid' ? toggleManualStage : toggleDeliverable;
                              return (
                                <button
                                  key={deliverable.id}
                                  onClick={() => toggle(deliverable.id)}
                                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                                    isSelected
                                      ? 'border-ey-yellow/50 bg-ey-yellow/5'
                                      : 'border-dark-border bg-dark-bg hover:border-dark-border-light'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-xs font-medium ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>
                                      {deliverable.name}
                                    </p>
                                    <p className="text-[10px] text-text-muted truncate">{deliverable.description}</p>
                                  </div>
                                  <div className={`flex h-4 w-4 items-center justify-center rounded border transition-all ${
                                    isSelected ? 'border-ey-yellow bg-ey-yellow' : 'border-dark-border-light'
                                  }`}>
                                    {isSelected && <Check className="h-3 w-3 text-dark-bg" />}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-text-muted mt-3">
                    {executionMode === 'hybrid'
                      ? `${manualStages.length} of ${allStageIds.length} stages selected as manual`
                      : `${selectedDeliverables.length} of ${allDeliverableIds.length} deliverables selected`}
                  </p>
                </motion.div>
              )}

              {/* Step 4: Build Type & BYOK */}
              {currentStep === 4 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                  {/* Build Type */}
                  <div>
                    <p className="text-sm font-medium text-text-primary mb-3">Build Type</p>
                    <div className="grid gap-3 md:grid-cols-3">
                      {buildTypes.map((type) => {
                        const Icon = type.icon;
                        const isSelected = buildType === type.id;
                        return (
                          <button
                            key={type.id}
                            onClick={() => setBuildType(type.id)}
                            className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all ${
                              isSelected
                                ? 'border-ey-yellow bg-ey-yellow/10'
                                : 'border-dark-border bg-dark-bg hover:border-dark-border-light'
                            }`}
                          >
                            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isSelected ? 'bg-ey-yellow/20' : 'bg-dark-card'}`}>
                              <Icon className={`h-5 w-5 ${isSelected ? 'text-ey-yellow' : 'text-text-secondary'}`} />
                            </div>
                            <p className={`text-xs font-medium ${isSelected ? 'text-ey-yellow' : 'text-text-primary'}`}>{type.name}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* BYOK */}
                  <div>
                    <p className="text-sm font-medium text-text-primary mb-1">BYOK Settings (Optional)</p>
                    <p className="text-xs text-text-muted mb-3">
                      Bring your own API keys, or use platform-managed keys for agent orchestration.
                    </p>
                    <div className="space-y-2">
                      {byokProviders.map((provider) => {
                        const settings = providerSettings[provider.id];
                        const isEnabled = settings?.enabled || false;
                        return (
                          <div
                            key={provider.id}
                            className={`rounded-lg border p-3 transition-all ${
                              isEnabled ? 'border-ey-yellow/30 bg-ey-yellow/5' : 'border-dark-border bg-dark-bg'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Cloud className={`h-4 w-4 ${isEnabled ? 'text-ey-yellow' : 'text-text-muted'}`} />
                                <span className="text-sm font-medium text-text-primary">{provider.name}</span>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={() => toggleProvider(provider.id)}
                                  className="sr-only peer"
                                />
                                <div className="w-9 h-5 rounded-full bg-dark-border peer-checked:bg-ey-yellow after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                              </label>
                            </div>
                            {isEnabled && (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  {(['platform', 'user'] as const).map((src) => (
                                    <button
                                      key={src}
                                      onClick={() =>
                                        setProviderSettings((prev) => ({
                                          ...prev,
                                          [provider.id]: { enabled: true, keySource: src },
                                        }))
                                      }
                                      className={`px-2 py-1 rounded text-[10px] transition-all ${
                                        settings?.keySource === src
                                          ? 'bg-ey-yellow/20 text-ey-yellow'
                                          : 'bg-dark-bg text-text-muted hover:text-text-secondary'
                                      }`}
                                    >
                                      {src === 'platform' ? 'Platform Key' : 'My Key'}
                                    </button>
                                  ))}
                                </div>
                                {settings?.keySource === 'user' && (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type={visibleKeys[provider.id] ? 'text' : 'password'}
                                      value={apiKeys[provider.id] || ''}
                                      onChange={(e) =>
                                        setApiKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))
                                      }
                                      placeholder={provider.placeholder}
                                      className="input-field flex-1 font-mono text-xs"
                                    />
                                    <button
                                      onClick={() =>
                                        setVisibleKeys((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))
                                      }
                                      className="rounded-lg border border-dark-border bg-dark-card p-2 text-text-muted hover:text-text-primary"
                                    >
                                      {visibleKeys[provider.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Step 5: Review & Launch */}
              {currentStep === 5 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                  <p className="text-sm font-medium text-text-primary mb-4">Review Project Configuration</p>
                  <Card className="space-y-4">
                    <div className="flex items-start justify-between pb-3 border-b border-dark-border">
                      <div>
                        <p className="text-xs text-text-muted">Project Name</p>
                        <p className="text-sm font-medium text-text-primary mt-1">{projectName || 'Untitled Project'}</p>
                      </div>
                      <button onClick={() => setCurrentStep(0)} className="text-xs text-ey-yellow hover:text-ey-yellow/80">Edit</button>
                    </div>
                    {projectDescription && (
                      <div className="pb-3 border-b border-dark-border">
                        <p className="text-xs text-text-muted">Description</p>
                        <p className="text-sm text-text-secondary mt-1">{projectDescription}</p>
                      </div>
                    )}
                    <div className="flex items-start justify-between pb-3 border-b border-dark-border">
                      <div>
                        <p className="text-xs text-text-muted">Project Type</p>
                        <p className="text-sm font-medium text-text-primary mt-1">{selectedType?.name || '-'}</p>
                      </div>
                      <button onClick={() => setCurrentStep(1)} className="text-xs text-ey-yellow hover:text-ey-yellow/80">Edit</button>
                    </div>
                    <div className="flex items-start justify-between pb-3 border-b border-dark-border">
                      <div>
                        <p className="text-xs text-text-muted">Execution Mode</p>
                        <p className="text-sm font-medium text-text-primary mt-1 capitalize">{selectedMode?.name || '-'}</p>
                      </div>
                      <button onClick={() => setCurrentStep(2)} className="text-xs text-ey-yellow hover:text-ey-yellow/80">Edit</button>
                    </div>
                    <div className="flex items-start justify-between pb-3 border-b border-dark-border">
                      <div>
                        <p className="text-xs text-text-muted">Build Type</p>
                        <p className="text-sm font-medium text-text-primary mt-1">{selectedBuildType?.name || '-'}</p>
                      </div>
                      <button onClick={() => setCurrentStep(4)} className="text-xs text-ey-yellow hover:text-ey-yellow/80">Edit</button>
                    </div>
                    {(executionMode === 'manual' || executionMode === 'hybrid') && (
                      <div className="pb-3 border-b border-dark-border">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-text-muted">
                            {executionMode === 'hybrid' ? 'Manual Stages' : 'Selected Deliverables'}
                          </p>
                          <button onClick={() => setCurrentStep(3)} className="text-xs text-ey-yellow hover:text-ey-yellow/80">Edit</button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {deliverablesToShow.length > 0 ? (
                            deliverablesToShow.map((id) => {
                              const d = deliverableCategories.flatMap((c) => c.deliverables).find((x) => x.id === id);
                              return (
                                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-ey-yellow/10 px-2 py-1 text-xs text-ey-yellow">
                                  {d?.name || id}
                                </span>
                              );
                            })
                          ) : (
                            <span className="text-xs text-text-muted">None selected</span>
                          )}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-text-muted mb-2">Provider Settings</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(providerSettings).filter(([, v]) => v.enabled).length > 0 ? (
                          Object.entries(providerSettings)
                            .filter(([, v]) => v.enabled)
                            .map(([id, v]) => (
                              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-ey-yellow/10 px-2 py-1 text-xs text-ey-yellow">
                                {byokProviders.find((p) => p.id === id)?.name} ({v.keySource === 'platform' ? 'Platform' : 'User Key'})
                              </span>
                            ))
                        ) : (
                          <span className="text-xs text-text-muted">Using default platform keys</span>
                        )}
                      </div>
                    </div>
                  </Card>
                  <div className="rounded-lg border border-ey-yellow/30 bg-ey-yellow/5 p-3">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-ey-yellow" />
                      <p className="text-xs text-ey-yellow font-medium">Ready to Launch</p>
                    </div>
                    <p className="text-[10px] text-text-muted mt-1">
                      AI agents will be initialized for {executionMode === 'auto' ? 'all SDLC stages' : `${deliverablesToShow.length} selected stage(s)`}.
                      Governance approvals will be required at key checkpoints.
                    </p>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-dark-border px-6 py-4">
              {launchError && (
                <p className="mr-4 text-xs text-status-error">{launchError}</p>
              )}
              <button
                onClick={handleBack}
                disabled={currentStep === 0}
                className={`btn-ghost text-sm ${currentStep === 0 ? 'opacity-0 pointer-events-none' : ''}`}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </button>
              {currentStep < steps.length - 1 ? (
                <button
                  onClick={handleNext}
                  disabled={!canProceed()}
                  className={`btn-primary text-sm ${!canProceed() ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  Next
                  <ChevronRight className="ml-2 h-4 w-4" />
                </button>
              ) : (
                <button onClick={handleLaunch} disabled={saving} className="btn-primary text-sm">
                  <Rocket className="mr-2 h-4 w-4" />
                  {saving ? 'Launching...' : 'Launch Project'}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
