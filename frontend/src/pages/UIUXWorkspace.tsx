import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Monitor,
  Smartphone,
  Tablet,
  MousePointer,
  Users,
  Zap,
  Download,
  FileJson,
  FileType,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Layout,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { buildApiUrl } from '../lib/api';
import type { UIUXDesignContent } from '../types/unified';
import DesignViewer from '../components/uiux/DesignViewer';
import ChatSidebar from '../components/uiux/ChatSidebar';

export function UIUXWorkspace() {
  const [activeTab, setActiveTab] = useState<'visual_editor' | 'screens' | 'flows' | 'wireframes' | 'components' | 'recommendations'>('visual_editor');
  const projectId = getSelectedProjectId();
  const { getUIUXDesign, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const design = getUIUXDesign();

  // Chat Editor State
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatSpec, setChatSpec] = useState<any>(null); // overrides design.ui_spec
  const [chatError, setChatError] = useState<string | null>(null);

  const handleChatSend = async (prompt: string) => {
    const newMessages = [...chatMessages, { role: 'user', content: prompt }];
    setChatMessages(newMessages);
    setIsChatLoading(true);
    setChatError(null);
    try {
       // Since the React app runs on vite port and FastAPI is typically 8000
       const apiUrl = buildApiUrl('/api/generate').replace(':5000', ':8000');
       const currentSpec = chatSpec || design?.ui_spec || {};
       const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
             messages: newMessages,
             current_spec: currentSpec,
             project_id: Number(projectId)
          })
       });
       if (!response.ok) throw new Error('Generation failed');
       const data = await response.json();
       setChatSpec(data);
       setChatMessages([...newMessages, { role: 'model', content: 'I have updated the design as requested. Let me know if you need any other changes!' }]);
    } catch (e: any) {
       console.error(e);
       setChatError(e.message || 'Failed to update UI');
    } finally {
       setIsChatLoading(false);
    }
  };


  const handleExport = async (format: 'json' | 'md') => {
    const activeSpec = chatSpec || design?.ui_spec || design;
    if (!projectId || !activeSpec) return;
    
    try {
      let content = '';
      let mimeType = '';
      
      if (format === 'json') {
        content = JSON.stringify(activeSpec, null, 2);
        mimeType = 'application/json';
      } else {
        content = `# UI/UX Design Specification\n\n`;
        if (activeSpec.pages && activeSpec.pages.length > 0) {
          content += `## Application Screens\n\n`;
          activeSpec.pages.forEach((page: any) => {
            content += `### ${page.page_name}\n- **Path**: \`${page.path}\`\n\n`;
          });
        }
        if (activeSpec.user_flows && activeSpec.user_flows.length > 0) {
          content += `## User Flows\n\n`;
          activeSpec.user_flows.forEach((flow: string, i: number) => {
            content += `${i + 1}. ${flow}\n`;
          });
          content += `\n`;
        }
        content += `> Note: The full interactive layout and component hierarchy is available in the Visual Editor canvas.\n`;
        mimeType = 'text/markdown';
      }

      const blob = new Blob([content], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `uiux_design_${projectId}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  if (!projectId) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No project selected</p>
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view UI/UX design.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading UI/UX design...</p>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Card className="border-status-error/30 bg-status-error/5 text-sm text-status-error">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
            <button onClick={reload} className="ml-auto underline hover:no-underline">Retry</button>
          </div>
        </Card>
      </div>
    );
  }

  if (!design) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <Monitor className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No UI/UX design generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the UI/UX Design Agent to generate screens, user flows, and wireframes.</p>
        </Card>
      </div>
    );
  }

  const currentSpec = chatSpec || design?.ui_spec || {};
  
  const metrics = [
    { label: 'Screens', value: currentSpec.pages?.length || design.screens?.length || 0, icon: Monitor, color: 'text-status-info' },
    { label: 'User Flows', value: currentSpec.user_flows?.length || design.userFlows?.length || 0, icon: Users, color: 'text-status-success' },
    { label: 'Wireframes', value: currentSpec.wireframes?.length || design.wireframes?.length || 0, icon: Tablet, color: 'text-status-warning' },
    { label: 'Recommendations', value: (design.componentRecommendations?.length || 0) + (design.uxRecommendations?.length || 0), icon: Zap, color: 'text-ey-yellow' },
  ];

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">UI/UX Design Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">User interface and experience design artifacts</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Design Generated
          </StatusBadge>
          <button onClick={reload} className="btn-ghost text-sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex items-center gap-1">
            <button onClick={() => handleExport('json')} className="btn-ghost text-xs" title="Export JSON">
              <FileJson className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => handleExport('md')} className="btn-ghost text-xs" title="Export Markdown">
              <FileType className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid gap-3 md:grid-cols-4 shrink-0">
        {metrics.map((metric) => (
          <Card key={metric.label} className="text-center py-3">
            <metric.icon className={`h-5 w-5 ${metric.color} mx-auto mb-1`} />
            <p className="text-xl font-bold text-text-primary">{metric.value}</p>
            <p className="text-[10px] text-text-muted">{metric.label}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-dark-border shrink-0">
        {[
          { id: 'visual_editor', label: 'Visual Editor', icon: Layout },
          { id: 'screens', label: 'Screens', icon: Monitor },
          { id: 'flows', label: 'User Flows', icon: Users },
          { id: 'wireframes', label: 'Wireframes', icon: Tablet },
          { id: 'components', label: 'Components', icon: MousePointer },
          { id: 'recommendations', label: 'Recommendations', icon: Zap },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-ey-yellow text-ey-yellow'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 w-full pb-6">
        {/* Visual Editor tab */}
        {activeTab === 'visual_editor' && (
          <div className="flex w-full gap-4 relative h-[calc(100vh-320px)] min-h-[500px]">
            <div className="flex-1 h-full relative bg-gray-950 rounded-xl border border-white/10 overflow-hidden shadow-xl">
              <DesignViewer spec={chatSpec || design.ui_spec} />
            </div>
            <div className="w-[400px] h-full shrink-0 relative z-50">
              <ChatSidebar 
                  messages={chatMessages} 
                  loading={isChatLoading} 
                  error={chatError} 
                  onSend={handleChatSend} 
              />
            </div>
          </div>
        )}

        {/* Screens tab */}
        {activeTab === 'screens' && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Monitor className="h-5 w-5 text-ey-yellow" />
              <h3 className="text-lg font-semibold text-text-primary">Application Screens</h3>
            </div>
            
            {currentSpec.pages && currentSpec.pages.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {currentSpec.pages.map((page: any, idx: number) => (
                  <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Smartphone className="h-4 w-4 text-ey-yellow" />
                      <h4 className="text-sm font-medium text-text-primary">{page.page_name}</h4>
                    </div>
                    <p className="text-xs text-text-muted">Path: {page.path}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                       <span className="text-[10px] px-2 py-0.5 rounded-full bg-ey-yellow/10 text-ey-yellow">View in Visual Editor</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {design.screens?.map((screen: any, idx: number) => (
                  <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Smartphone className="h-4 w-4 text-ey-yellow" />
                      <h4 className="text-sm font-medium text-text-primary">{screen.name}</h4>
                    </div>
                    <p className="text-xs text-text-muted">{screen.purpose}</p>
                    {screen.components?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {screen.components.map((c: string, ci: number) => (
                          <span key={ci} className="text-[10px] px-2 py-0.5 rounded-full bg-ey-yellow/10 text-ey-yellow">{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* User Flows tab */}
        {activeTab === 'flows' && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-5 w-5 text-ey-yellow" />
              <h3 className="text-lg font-semibold text-text-primary">User Flows</h3>
            </div>
            
            {currentSpec.user_flows && currentSpec.user_flows.length > 0 ? (
              <div className="space-y-3">
                {currentSpec.user_flows.map((flow: string, idx: number) => (
                  <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="h-6 w-6 rounded-full bg-ey-yellow/20 flex items-center justify-center text-xs font-bold text-ey-yellow">
                          {idx + 1}
                        </div>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-text-primary">{flow}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {design.userFlows?.map((flow: any, idx: number) => (
                  <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="h-6 w-6 rounded-full bg-ey-yellow/20 flex items-center justify-center text-xs font-bold text-ey-yellow">
                          {idx + 1}
                        </div>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-text-primary">{flow.name}</p>
                        {flow.steps?.length > 0 && (
                          <ol className="mt-1 list-decimal list-inside text-xs text-text-muted space-y-0.5">
                            {flow.steps.map((step: string, si: number) => (
                              <li key={si}>{step}</li>
                            ))}
                          </ol>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Wireframes tab */}
        {activeTab === 'wireframes' && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Tablet className="h-5 w-5 text-ey-yellow" />
              <h3 className="text-lg font-semibold text-text-primary">Wireframes</h3>
            </div>
            {currentSpec.pages && currentSpec.pages.length > 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-dark-border rounded-lg bg-black/20">
                <Tablet className="h-12 w-12 text-text-muted mb-4 opacity-50" />
                <h4 className="text-lg font-medium text-text-primary">Integrated into Visual Editor</h4>
                <p className="text-sm text-text-muted mt-2 max-w-md">The AI has generated full high-fidelity component trees. Please use the <strong>Visual Editor</strong> tab to view and interact with the interactive wireframes directly.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {design.wireframes?.map((wireframe: any, idx: number) => (
                  <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                    <p className="text-sm text-text-primary font-medium">{wireframe.screen}</p>
                    <p className="text-xs text-text-muted mt-1">{wireframe.layout}</p>
                    <p className="text-xs text-text-muted mt-1">{wireframe.description}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Components tab */}
        {activeTab === 'components' && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <MousePointer className="h-5 w-5 text-ey-yellow" />
              <h3 className="text-lg font-semibold text-text-primary">Component Recommendations</h3>
            </div>
            {currentSpec.pages && currentSpec.pages.length > 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-dark-border rounded-lg bg-black/20">
                <MousePointer className="h-12 w-12 text-text-muted mb-4 opacity-50" />
                <h4 className="text-lg font-medium text-text-primary">Integrated into Visual Editor</h4>
                <p className="text-sm text-text-muted mt-2 max-w-md">All component hierarchies and design systems are now embedded directly within the active React Flow canvas. Check the <strong>Visual Editor</strong> tab.</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {design.componentRecommendations?.map((rec: any, idx: number) => (
                  <div key={idx} className="rounded-lg bg-dark-bg p-3 border border-dark-border">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-status-success mt-0.5" />
                      <div>
                        <p className="text-xs text-text-primary font-medium">{rec.name} <span className="text-text-muted font-normal">({rec.type}{rec.library ? ` · ${rec.library}` : ''})</span></p>
                        <p className="text-xs text-text-muted mt-1">{rec.rationale}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Recommendations tab */}
        {activeTab === 'recommendations' && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-5 w-5 text-ey-yellow" />
              <h3 className="text-lg font-semibold text-text-primary">UX Recommendations</h3>
            </div>
            {currentSpec.pages && currentSpec.pages.length > 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-dark-border rounded-lg bg-black/20">
                <Zap className="h-12 w-12 text-text-muted mb-4 opacity-50" />
                <h4 className="text-lg font-medium text-text-primary">Applied Automatically</h4>
                <p className="text-sm text-text-muted mt-2 max-w-md">Best practices and premium UX aesthetics (glassmorphism, massive padding, gradient typography) are actively injected into the <strong>Visual Editor</strong> by the elite AI Architect.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {design.uxRecommendations?.map((rec: string, idx: number) => (
                  <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        <Zap className="h-4 w-4 text-ey-yellow" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-text-primary">{rec}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}