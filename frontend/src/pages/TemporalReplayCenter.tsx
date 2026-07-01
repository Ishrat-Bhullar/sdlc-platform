import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Clock,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { Timer as Timeline } from 'lucide-react';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { apiRequest } from '../lib/api';
import type { TimelineEvent, AgentRun } from '../types/unified';

export function TemporalReplayCenter() {
  const [activeTab, setActiveTab] = useState<'timeline' | 'events' | 'replay'>('timeline');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  
  const projectId = getSelectedProjectId();
  const { artifacts, loading, error, reload } = useUnifiedArtifacts(projectId);

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Load timeline events from API
  useEffect(() => {
    if (!projectId) return;
    
    const loadEvents = async () => {
      setLoadingEvents(true);
      try {
        const [eventsResp, runsResp] = await Promise.all([
          apiRequest<TimelineEvent[] | { events?: TimelineEvent[] }>(`/temporal/${projectId}/events`),
          apiRequest<AgentRun[] | { agents?: AgentRun[] }>(`/dashboard/agents?project_id=${projectId}`),
        ]);
        // FastAPI returns { events: [...], ... }; handle both formats
        const eventsArr = Array.isArray(eventsResp) ? eventsResp : ((eventsResp as any)?.events || []);
        setTimelineEvents(eventsArr);
        const runs = Array.isArray(runsResp) ? runsResp : (runsResp.agents || []);
        setAgentRuns(runs);
      } catch (e) {
        console.error('Failed to load timeline events:', e);
      } finally {
        setLoadingEvents(false);
      }
    };

    loadEvents();
  }, [projectId]);

  // Derive timeline events from agent runs if API doesn't return them
  const derivedEvents = useMemo(() => {
    if (timelineEvents.length > 0) return timelineEvents;
    
    // Create timeline events from agent runs
    return agentRuns
      .filter(r => r.start_time)
      .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
      .map((run, index) => ({
        id: `event-${index}`,
        project_id: run.project_id,
        stage: run.agent_name,
        status: run.status as any,
        timestamp: run.start_time!,
        agent_name: run.agent_name,
        metadata: run.end_time ? { duration: new Date(run.end_time).getTime() - new Date(run.start_time!).getTime() } : undefined,
      } as TimelineEvent));
  }, [timelineEvents, agentRuns]);

  const filteredEvents = useMemo(() => {
    return derivedEvents.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [derivedEvents]);

  const completedEvents = derivedEvents.filter(e => e.status === 'completed').length;
  const failedEvents = derivedEvents.filter(e => e.status === 'failed').length;
  const runningEvents = derivedEvents.filter(e => e.status === 'running').length;

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleNext = () => {
    if (currentEventIndex < filteredEvents.length - 1) {
      setCurrentEventIndex(currentEventIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentEventIndex > 0) {
      setCurrentEventIndex(currentEventIndex - 1);
    }
  };

  const handleReset = () => {
    setCurrentEventIndex(0);
    setIsPlaying(false);
  };

  // Auto-advance when playing
  useEffect(() => {
    if (!isPlaying) return;
    
    const interval = setInterval(() => {
      if (currentEventIndex < filteredEvents.length - 1) {
        setCurrentEventIndex(currentEventIndex + 1);
      } else {
        setIsPlaying(false);
      }
    }, 1000 / playbackSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, currentEventIndex, filteredEvents.length, playbackSpeed]);

  if (!projectId) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No project selected</p>
          <p className="text-xs text-text-muted mt-1">Select a project to view timeline.</p>
        </Card>
      </div>
    );
  }

  if (loading || loadingEvents) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading timeline...</p>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Temporal Replay Center</h1>
          <p className="mt-1 text-sm text-text-muted">Pipeline execution timeline and replay</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} className="btn-ghost text-sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="text-center py-3">
          <Timeline className="h-5 w-5 text-status-info mx-auto mb-1" />
          <p className="text-xl font-bold text-text-primary">{filteredEvents.length}</p>
          <p className="text-[10px] text-text-muted">Total Events</p>
        </Card>
        <Card className="text-center py-3">
          <CheckCircle2 className="h-5 w-5 text-status-success mx-auto mb-1" />
          <p className="text-xl font-bold text-text-primary">{completedEvents}</p>
          <p className="text-[10px] text-text-muted">Completed</p>
        </Card>
        <Card className="text-center py-3">
          <Activity className="h-5 w-5 text-status-info mx-auto mb-1" />
          <p className="text-xl font-bold text-text-primary">{runningEvents}</p>
          <p className="text-[10px] text-text-muted">Running</p>
        </Card>
        <Card className="text-center py-3">
          <XCircle className="h-5 w-5 text-status-error mx-auto mb-1" />
          <p className="text-xl font-bold text-text-primary">{failedEvents}</p>
          <p className="text-[10px] text-text-muted">Failed</p>
        </Card>
      </div>

      {/* Playback Controls */}
      <Card>
        <div className="flex items-center gap-3">
          <button onClick={handleReset} className="btn-ghost text-xs" title="Reset">
            <SkipBack className="h-4 w-4" />
          </button>
          <button onClick={handlePrevious} className="btn-ghost text-xs" title="Previous">
            <SkipBack className="h-4 w-4" />
          </button>
          <button onClick={handlePlayPause} className="btn-primary text-sm" title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button onClick={handleNext} className="btn-ghost text-xs" title="Next">
            <SkipForward className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 ml-4">
            <span className="text-xs text-text-muted">Speed:</span>
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="input-field text-xs"
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="4">4x</option>
            </select>
          </div>
          <div className="ml-auto text-xs text-text-muted">
            Event {currentEventIndex + 1} of {filteredEvents.length}
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex border-b border-dark-border">
        {[
          { id: 'timeline', label: 'Timeline', icon: Timeline },
          { id: 'events', label: 'Events', icon: Clock },
          { id: 'replay', label: 'Replay', icon: Play },
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

      {/* Timeline View */}
      {activeTab === 'timeline' && (
        <Card>
          <div className="space-y-4">
            {filteredEvents.length === 0 ? (
              <div className="py-8 text-center">
                <Timeline className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                <p className="text-sm text-text-muted">No timeline events yet.</p>
              </div>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-dark-border" />
                
                {/* Events */}
                <div className="space-y-4">
                  {filteredEvents.map((event, index) => {
                    const isActive = index === currentEventIndex;
                    const statusColor = event.status === 'completed' ? 'bg-status-success'
                      : event.status === 'failed' ? 'bg-status-error'
                      : event.status === 'running' ? 'bg-status-info'
                      : 'bg-dark-border';
                    
                    return (
                      <motion.div
                        key={event.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={`relative flex items-start gap-4 p-3 rounded-lg transition-colors ${
                          isActive ? 'bg-ey-yellow/10 border border-ey-yellow' : 'bg-dark-bg'
                        }`}
                      >
                        {/* Timeline dot */}
                        <div className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${statusColor} border-dark-bg`}>
                          {event.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-white" />}
                          {event.status === 'failed' && <XCircle className="h-4 w-4 text-white" />}
                          {event.status === 'running' && <Activity className="h-4 w-4 text-white animate-pulse" />}
                          {event.status === 'pending' && <Clock className="h-4 w-4 text-text-muted" />}
                        </div>

                        {/* Event content */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-sm font-medium text-text-primary capitalize">
                              {event.stage.replace(/_/g, ' ')}
                            </h4>
                            <StatusBadge status={
                              event.status === 'completed' ? 'success'
                              : event.status === 'failed' ? 'error'
                              : event.status === 'running' ? 'running'
                              : 'pending'
                            }>
                              {event.status}
                            </StatusBadge>
                          </div>
                          <p className="text-xs text-text-muted">
                            {new Date(event.timestamp).toLocaleString()}
                          </p>
                          {event.metadata && (
                            <p className="text-xs text-text-secondary mt-1">
                              Duration: {((event.metadata as any).duration / 1000).toFixed(1)}s
                            </p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Events List */}
      {activeTab === 'events' && (
        <Card>
          <div className="space-y-2">
            {filteredEvents.length === 0 ? (
              <div className="py-8 text-center">
                <Clock className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                <p className="text-sm text-text-muted">No events recorded yet.</p>
              </div>
            ) : (
              filteredEvents.map((event, index) => (
                <div
                  key={event.id}
                  className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                    index === currentEventIndex ? 'bg-ey-yellow/10 border border-ey-yellow' : 'bg-dark-bg'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${
                      event.status === 'completed' ? 'bg-status-success'
                      : event.status === 'failed' ? 'bg-status-error'
                      : event.status === 'running' ? 'bg-status-info'
                      : 'bg-dark-border'
                    }`} />
                    <div>
                      <p className="text-sm font-medium text-text-primary capitalize">
                        {event.stage.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-text-muted">
                        {new Date(event.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={
                    event.status === 'completed' ? 'success'
                    : event.status === 'failed' ? 'error'
                    : event.status === 'running' ? 'running'
                    : 'pending'
                  }>
                    {event.status}
                  </StatusBadge>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {/* Replay View */}
      {activeTab === 'replay' && (
        <Card>
          <div className="py-8 text-center">
            <Play className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
            <p className="text-sm text-text-muted mb-4">
              Replay pipeline execution from event {currentEventIndex + 1} of {filteredEvents.length}
            </p>
            {filteredEvents[currentEventIndex] && (
              <div className="bg-dark-bg p-4 rounded-lg text-left">
                <h4 className="text-sm font-medium text-text-primary mb-2">
                  Current Event: {filteredEvents[currentEventIndex].stage.replace(/_/g, ' ')}
                </h4>
                <p className="text-xs text-text-muted">
                  Status: {filteredEvents[currentEventIndex].status}
                </p>
                <p className="text-xs text-text-muted">
                  Timestamp: {new Date(filteredEvents[currentEventIndex].timestamp).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}