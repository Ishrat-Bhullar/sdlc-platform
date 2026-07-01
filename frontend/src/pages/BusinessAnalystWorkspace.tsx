/**
 * BusinessAnalystWorkspace.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full Business Analyst workspace showing Epics, User Stories, Acceptance
 * Criteria, Story Points, Priorities, MoSCoW classification, Personas,
 * and editable tables — all sourced from the user_stories artifact.
 */
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Briefcase,
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  BarChart3,
  Edit3,
  Save,
  RefreshCw,
  Download,
  Layers,
  Target,
  Lightbulb,
  Zap,
  FileJson,
  FileType,
  FileText as FileTextIcon,
  File,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useProjectArtifacts } from '../lib/useProjectArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { buildApiUrl } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoryRow {
  id: string;
  title: string;
  epic: string;
  role: string;
  goal: string;
  benefit: string;
  priority: string;
  moscow: string;
  points: number;
  status: string;
  acceptanceCriteria: string[];
}

interface EpicSummary {
  title: string;
  description: string;
  storyCount: number;
  totalPoints: number;
}

interface Persona {
  name: string;
  role: string;
  goal: string;
  painPoints: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseContent(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return { raw_text: raw }; }
  }
  return raw as Record<string, unknown>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BusinessAnalystWorkspace() {
  const [activeTab, setActiveTab] = useState<'stories' | 'epics' | 'personas'>('stories');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<StoryRow>>({});

  const projectId = getSelectedProjectId();
  const { artifacts, loading, error, reload } = useProjectArtifacts(projectId);

  const storiesArtifact = useMemo(
    () => artifacts.find((a) => a.artifact_type === 'user_stories') || null,
    [artifacts]
  );

  const storiesData = useMemo(() => {
    if (!storiesArtifact) return { epics: [], stories: [], personas: [] };
    const data = parseContent(storiesArtifact.content);
    return {
      epics: (data.epics as any[]) || [],
      stories: (data.stories as any[]) || [],
      personas: (data.personas as any[]) || [],
    };
  }, [storiesArtifact]);

  // Build story rows from epics + direct stories
  const storyRows: StoryRow[] = useMemo(() => {
    const fromEpics: StoryRow[] = (storiesData.epics || []).flatMap((e: any, idx: number) => {
      const epicTitle = e?.title || e?.name || `Epic-${idx + 1}`;
      const items = Array.isArray(e?.stories) ? e.stories : [];
      return items.map((s: any, sIdx: number) => ({
        id: String(s?.id ?? `US-${idx + 1}.${sIdx + 1}`),
        title: String(s?.title ?? ''),
        epic: String(s?.epic ?? epicTitle),
        role: String(s?.role ?? ''),
        goal: String(s?.goal ?? ''),
        benefit: String(s?.benefit ?? ''),
        priority: String(s?.priority ?? s?.moscowPriority ?? 'medium'),
        moscow: String(s?.moscow ?? s?.moscowPriority ?? 'Should'),
        points: Number(s?.points ?? 0),
        status: String(s?.status ?? 'todo'),
        acceptanceCriteria: Array.isArray(s?.acceptance_criteria)
          ? s.acceptance_criteria.map((ac: any) => typeof ac === 'string' ? ac : ac?.description || '')
          : [],
      }));
    });

    const fromDirect: StoryRow[] = (storiesData.stories || []).map((s: any, idx: number) => ({
      id: String(s?.id ?? `US-D${idx + 1}`),
      title: String(s?.title ?? ''),
      epic: String(s?.epic ?? ''),
      role: String(s?.role ?? ''),
      goal: String(s?.goal ?? ''),
      benefit: String(s?.benefit ?? ''),
      priority: String(s?.priority ?? s?.moscowPriority ?? 'medium'),
      moscow: String(s?.moscow ?? s?.moscowPriority ?? 'Should'),
      points: Number(s?.points ?? 0),
      status: String(s?.status ?? 'todo'),
      acceptanceCriteria: Array.isArray(s?.acceptance_criteria)
        ? s.acceptance_criteria.map((ac: any) => typeof ac === 'string' ? ac : ac?.description || '')
        : [],
    }));

    return [...fromEpics, ...fromDirect];
  }, [storiesData]);

  // Epic summaries
  const epicSummaries: EpicSummary[] = useMemo(() => {
    const map = new Map<string, { description: string; stories: StoryRow[] }>();
    for (const s of storyRows) {
      if (!map.has(s.epic)) map.set(s.epic, { description: '', stories: [] });
      map.get(s.epic)!.stories.push(s);
    }
    // Also add epics from the data that may have no stories
    for (const e of storiesData.epics || []) {
      const title = e?.title || e?.name || '';
      if (!map.has(title)) map.set(title, { description: e?.description || '', stories: [] });
      else {
        const existing = map.get(title)!;
        if (!existing.description) existing.description = e?.description || '';
      }
    }
    return Array.from(map.entries()).map(([title, val]) => ({
      title,
      description: val.description,
      storyCount: val.stories.length,
      totalPoints: val.stories.reduce((sum, s) => sum + s.points, 0),
    }));
  }, [storyRows, storiesData]);

  // Personas
  const personas: Persona[] = useMemo(() => {
    const fromData: Persona[] = (storiesData.personas || []).map((p: any) => ({
      name: String(p?.name ?? ''),
      role: String(p?.role ?? ''),
      goal: String(p?.goal ?? ''),
      painPoints: Array.isArray(p?.painPoints) ? p.painPoints.map(String) : [],
    }));
    // Derive personas from stories if not explicitly defined
    if (fromData.length === 0) {
      const roles = new Set(storyRows.map((s) => s.role).filter(Boolean));
      return Array.from(roles).map((role) => ({
        name: role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        role,
        goal: `As a ${role}, I want to use the banking portal effectively`,
        painPoints: ['Needs clear navigation', 'Requires fast access to information'],
      }));
    }
    return fromData;
  }, [storiesData, storyRows]);

  // Metrics
  const totalStories = storyRows.length;
  const totalPoints = storyRows.reduce((s, r) => s + r.points, 0);
  const moscowCounts = { Must: 0, Should: 0, Could: 0, 'Won\'t': 0 };
  for (const s of storyRows) {
    const m = s.moscow as keyof typeof moscowCounts;
    if (m in moscowCounts) moscowCounts[m]++;
  }
  const completedStories = storyRows.filter((s) => s.status === 'done').length;

  // Edit handlers
  const startEdit = (story: StoryRow) => {
    setEditingId(story.id);
    setEditValues({ ...story });
  };

  const saveEdit = () => {
    setEditingId(null);
    setEditValues({});
    // In a real app, this would call an API to persist changes
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const noProject = !projectId;

  const handleExport = async (format: 'json' | 'md' | 'pdf' | 'docx') => {
    if (!projectId || !storiesArtifact) return;
try {
      const url = buildApiUrl(`/documents/export-artifact?projectId=${projectId}&artifact_type=user_stories&format=${format}`);
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `user_stories_${projectId}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Business Analyst Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">Epics, user stories, and requirements analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            {totalStories} Stories
          </StatusBadge>
          <StatusBadge status="info">
            <BarChart3 className="mr-1 h-3 w-3" />
            {totalPoints} Points
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
            <button onClick={() => handleExport('pdf')} className="btn-ghost text-xs" title="Export PDF">
              <FileTextIcon className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => handleExport('docx')} className="btn-ghost text-xs" title="Export DOCX">
              <File className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Card className="border-status-error/30 bg-status-error/5 text-sm text-status-error">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
            <button onClick={reload} className="ml-auto underline hover:no-underline">Retry</button>
          </div>
        </Card>
      )}

      {noProject ? (
        <Card className="py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No project selected</p>
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view business analysis.</p>
        </Card>
      ) : (
        <>
          {/* Metrics row */}
          <div className="grid gap-3 md:grid-cols-5">
            <Card className="text-center py-3">
              <Layers className="h-5 w-5 text-ey-yellow mx-auto mb-1" />
              <p className="text-xl font-bold text-text-primary">{epicSummaries.length}</p>
              <p className="text-[10px] text-text-muted">Epics</p>
            </Card>
            <Card className="text-center py-3">
              <FileText className="h-5 w-5 text-status-info mx-auto mb-1" />
              <p className="text-xl font-bold text-text-primary">{totalStories}</p>
              <p className="text-[10px] text-text-muted">User Stories</p>
            </Card>
            <Card className="text-center py-3">
              <Target className="h-5 w-5 text-status-success mx-auto mb-1" />
              <p className="text-xl font-bold text-status-success">{totalPoints}</p>
              <p className="text-[10px] text-text-muted">Story Points</p>
            </Card>
            <Card className="text-center py-3">
              <CheckCircle2 className="h-5 w-5 text-status-success mx-auto mb-1" />
              <p className="text-xl font-bold text-status-success">{completedStories}/{totalStories}</p>
              <p className="text-[10px] text-text-muted">Completed</p>
            </Card>
            <Card className="text-center py-3">
              <Users className="h-5 w-5 text-status-warning mx-auto mb-1" />
              <p className="text-xl font-bold text-text-primary">{personas.length}</p>
              <p className="text-[10px] text-text-muted">Personas</p>
            </Card>
          </div>

          {/* MoSCoW breakdown */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-ey-yellow" />
              <h3 className="section-title mb-0">MoSCoW Classification</h3>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {(['Must', 'Should', 'Could', "Won't"] as const).map((cat) => {
                const count = moscowCounts[cat] || 0;
                const pct = totalStories > 0 ? Math.round((count / totalStories) * 100) : 0;
                const colors: Record<string, string> = {
                  Must: 'bg-status-error text-status-error',
                  Should: 'bg-status-warning text-status-warning',
                  Could: 'bg-status-info text-status-info',
                  "Won't": 'bg-text-muted text-text-muted',
                };
                return (
                  <div key={cat} className="text-center">
                    <div className={`text-xs font-semibold mb-1 ${colors[cat].split(' ')[1]}`}>{cat}</div>
                    <div className="text-2xl font-bold text-text-primary">{count}</div>
                    <div className="text-[10px] text-text-muted">{pct}%</div>
                    <div className="mt-1 h-1.5 rounded-full bg-dark-border overflow-hidden">
                      <div className={`h-full rounded-full ${colors[cat].split(' ')[0]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Tabs */}
          <div className="flex border-b border-dark-border">
            {[
              { id: 'stories', label: 'User Stories', icon: FileText },
              { id: 'epics', label: 'Epics', icon: Layers },
              { id: 'personas', label: 'Personas', icon: Users },
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

          {/* Stories tab */}
          {activeTab === 'stories' && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="section-title mb-0">User Stories</h3>
                <span className="text-xs text-text-muted">{totalStories} stories · Click to edit</span>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin text-ey-yellow" />
                </div>
              ) : storyRows.length === 0 ? (
                <div className="py-8 text-center">
                  <FileText className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No user stories generated yet.</p>
                  <p className="text-xs text-text-muted mt-1">Run the Business Analyst Agent in the pipeline.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-dark-border">
                        <th className="text-left text-xs font-medium text-text-muted pb-3">ID</th>
                        <th className="text-left text-xs font-medium text-text-muted pb-3">Title</th>
                        <th className="text-left text-xs font-medium text-text-muted pb-3">Epic</th>
                        <th className="text-left text-xs font-medium text-text-muted pb-3">Role</th>
                        <th className="text-left text-xs font-medium text-text-muted pb-3">MoSCoW</th>
                        <th className="text-left text-xs font-medium text-text-muted pb-3">Points</th>
                        <th className="text-left text-xs font-medium text-text-muted pb-3">Status</th>
                        <th className="text-left text-xs font-medium text-text-muted pb-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storyRows.map((story) => (
                        <tr key={story.id} className="border-b border-dark-border/50 hover:bg-dark-cardHover">
                          {editingId === story.id ? (
                            <>
                              <td className="py-3 text-xs font-mono text-text-muted">{story.id}</td>
                              <td className="py-3">
                                <input
                                  className="input-field text-xs w-full"
                                  value={editValues.title || ''}
                                  onChange={(e) => setEditValues({ ...editValues, title: e.target.value })}
                                />
                              </td>
                              <td className="py-3">
                                <input
                                  className="input-field text-xs w-full"
                                  value={editValues.epic || ''}
                                  onChange={(e) => setEditValues({ ...editValues, epic: e.target.value })}
                                />
                              </td>
                              <td className="py-3">
                                <input
                                  className="input-field text-xs w-full"
                                  value={editValues.role || ''}
                                  onChange={(e) => setEditValues({ ...editValues, role: e.target.value })}
                                />
                              </td>
                              <td className="py-3">
                                <select
                                  className="input-field text-xs"
                                  value={editValues.moscow || 'Should'}
                                  onChange={(e) => setEditValues({ ...editValues, moscow: e.target.value })}
                                >
                                  <option>Must</option><option>Should</option><option>Could</option><option>Won't</option>
                                </select>
                              </td>
                              <td className="py-3">
                                <input
                                  className="input-field text-xs w-16"
                                  type="number"
                                  value={editValues.points || 0}
                                  onChange={(e) => setEditValues({ ...editValues, points: parseInt(e.target.value) || 0 })}
                                />
                              </td>
                              <td className="py-3">
                                <select
                                  className="input-field text-xs"
                                  value={editValues.status || 'todo'}
                                  onChange={(e) => setEditValues({ ...editValues, status: e.target.value })}
                                >
                                  <option>todo</option><option>in-progress</option><option>review</option><option>done</option>
                                </select>
                              </td>
                              <td className="py-3">
                                <div className="flex gap-1">
                                  <button onClick={saveEdit} className="p-1 rounded hover:bg-dark-surface text-status-success"><Save className="h-3.5 w-3.5" /></button>
                                  <button onClick={cancelEdit} className="p-1 rounded hover:bg-dark-surface text-status-error"><Clock className="h-3.5 w-3.5" /></button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-3 text-xs font-mono text-text-muted">{story.id}</td>
                              <td className="py-3 text-sm text-text-primary max-w-xs truncate">{story.title}</td>
                              <td className="py-3 text-xs text-text-secondary">{story.epic}</td>
                              <td className="py-3 text-xs text-text-muted">{story.role}</td>
                              <td className="py-3">
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                                  story.moscow === 'Must' ? 'bg-status-error/10 text-status-error'
                                  : story.moscow === 'Should' ? 'bg-status-warning/10 text-status-warning'
                                  : story.moscow === 'Could' ? 'bg-status-info/10 text-status-info'
                                  : 'bg-dark-border text-text-muted'
                                }`}>{story.moscow}</span>
                              </td>
                              <td className="py-3 text-xs text-text-secondary">{story.points}</td>
                              <td className="py-3">
                                <StatusBadge status={
                                  story.status === 'done' ? 'success'
                                  : story.status === 'in-progress' ? 'running'
                                  : story.status === 'review' ? 'warning'
                                  : 'pending'
                                }>{story.status}</StatusBadge>
                              </td>
                              <td className="py-3">
                                <button onClick={() => startEdit(story)} className="p-1 rounded hover:bg-dark-surface text-text-muted hover:text-ey-yellow">
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Acceptance Criteria for selected story */}
              {storyRows.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs text-ey-yellow font-medium">View Acceptance Criteria</summary>
                  <div className="mt-3 space-y-2">
                    {storyRows.slice(0, 3).map((story) => (
                      <div key={story.id} className="rounded-lg bg-dark-bg p-3">
                        <p className="text-xs font-medium text-text-primary mb-1">{story.id}: {story.title}</p>
                        {story.acceptanceCriteria.length > 0 ? (
                          <ul className="list-disc list-inside space-y-0.5">
                            {story.acceptanceCriteria.map((ac, i) => (
                              <li key={i} className="text-[10px] text-text-muted">{ac}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[10px] text-text-muted italic">No acceptance criteria defined</p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          )}

          {/* Epics tab */}
          {activeTab === 'epics' && (
            <div className="grid gap-4 md:grid-cols-2">
              {epicSummaries.length === 0 ? (
                <Card className="col-span-full py-8 text-center">
                  <Layers className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No epics defined yet.</p>
                </Card>
              ) : (
                epicSummaries.map((epic, i) => (
                  <motion.div
                    key={epic.title}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Card>
                      <div className="flex items-center gap-2 mb-2">
                        <Layers className="h-4 w-4 text-ey-yellow" />
                        <h3 className="text-sm font-semibold text-text-primary">{epic.title}</h3>
                      </div>
                      {epic.description && (
                        <p className="text-xs text-text-secondary mb-3">{epic.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-text-muted">
                        <span>{epic.storyCount} stories</span>
                        <span>·</span>
                        <span>{epic.totalPoints} points</span>
                      </div>
                      <div className="mt-2 h-1 rounded-full bg-dark-border overflow-hidden">
                        <div className="h-full rounded-full bg-ey-yellow" style={{ width: `${Math.min(100, epic.storyCount * 20)}%` }} />
                      </div>
                    </Card>
                  </motion.div>
                ))
              )}
            </div>
          )}

          {/* Personas tab */}
          {activeTab === 'personas' && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {personas.length === 0 ? (
                <Card className="col-span-full py-8 text-center">
                  <Users className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No personas defined yet.</p>
                </Card>
              ) : (
                personas.map((persona, i) => (
                  <motion.div
                    key={persona.name}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Card>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ey-yellow/10">
                          <Users className="h-4 w-4 text-ey-yellow" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-text-primary">{persona.name}</h3>
                          <p className="text-[10px] text-text-muted">{persona.role}</p>
                        </div>
                      </div>
                      <p className="text-xs text-text-secondary mb-2">
                        <span className="font-medium text-text-primary">Goal:</span> {persona.goal}
                      </p>
                      {persona.painPoints.length > 0 && (
                        <div>
                          <p className="text-[10px] font-medium text-text-muted mb-1">Pain Points:</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {persona.painPoints.map((p, j) => (
                              <li key={j} className="text-[10px] text-text-muted">{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </Card>
                  </motion.div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}