const { WebSocketServer } = require('ws');

let wss = null;

// projectId -> Set<ws>
const rooms = new Map();

const initWebSocket = (httpServer) => {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId') || 'global';

    if (!rooms.has(projectId)) rooms.set(projectId, new Set());
    rooms.get(projectId).add(ws);

    ws._projectId = projectId;

    ws.send(JSON.stringify({
      event: 'connected',
      projectId,
      payload: { connections: rooms.get(projectId).size },
      timestamp: new Date().toISOString(),
    }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch (_) { /* ignore malformed */ }
    });

    ws.on('close', () => {
      const room = rooms.get(ws._projectId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) rooms.delete(ws._projectId);
      }
    });

    ws.on('error', () => {
      const room = rooms.get(ws._projectId);
      if (room) room.delete(ws);
    });
  });

  console.log('🔌 WebSocket server initialised on /ws');
};

/**
 * Broadcast an event to all clients subscribed to a project.
 * Falls back to 'global' room if projectId is falsy.
 *
 * @param {string|number} projectId
 * @param {{ event: string, payload?: object }} data
 */
const broadcast = (projectId, data) => {
  if (!wss) return;

  const envelope = JSON.stringify({
    ...data,
    projectId: String(projectId),
    timestamp: new Date().toISOString(),
  });

  const targets = [
    ...(rooms.get(String(projectId)) || []),
    ...(rooms.get('global') || []),
  ];

  for (const client of targets) {
    if (client.readyState === 1 /* OPEN */) {
      try { client.send(envelope); } catch (_) { /* skip dead socket */ }
    }
  }
};

// ── Typed event helpers used by controllers and agentOrchestrator ─────────────

const emitAgentStarted = (projectId, agentName, executionId) =>
  broadcast(projectId, {
    event: 'agent_started',
    payload: { agentName, executionId },
  });

const emitAgentProgress = (projectId, agentName, executionId, progress, currentTask) =>
  broadcast(projectId, {
    event: 'agent_progress',
    payload: { agentName, executionId, progress, currentTask },
  });

const emitAgentCompleted = (projectId, agentName, executionId, status, tokens, cost) =>
  broadcast(projectId, {
    event: 'agent_completed',
    payload: { agentName, executionId, status, tokens, cost },
  });

const emitArtifactGenerated = (projectId, artifactType, summary) =>
  broadcast(projectId, {
    event: 'artifact_generated',
    payload: { artifactType, summary },
  });

const emitApprovalRequested = (projectId, approvalId, type, title) =>
  broadcast(projectId, {
    event: 'approval_requested',
    payload: { approvalId, type, title },
  });

const emitApprovalCompleted = (projectId, approvalId, status, decidedBy) =>
  broadcast(projectId, {
    event: 'approval_completed',
    payload: { approvalId, status, decidedBy },
  });

const emitProjectProgress = (projectId, progress, status) =>
  broadcast(projectId, {
    event: 'project_progress',
    payload: { progress, status },
  });

// ── Live code-generation streaming (simulated replay of already-generated
// files — see agentOrchestrator._streamGeneratedFiles) ─────────────────────

const emitCodeGenStarted = (projectId, agentType, totalFiles) =>
  broadcast(projectId, {
    event: 'code_gen_started',
    payload: { agentType, totalFiles },
  });

const emitCodeChunk = (projectId, agentType, filePath, language, chunk, isFirstChunk, isLastChunk) =>
  broadcast(projectId, {
    event: 'code_chunk',
    payload: { agentType, filePath, language, chunk, isFirstChunk, isLastChunk },
  });

const emitCodeGenCompleted = (projectId, agentType, fileCount, linesOfCode) =>
  broadcast(projectId, {
    event: 'code_gen_completed',
    payload: { agentType, fileCount, linesOfCode },
  });

module.exports = {
  initWebSocket,
  broadcast,
  emitAgentStarted,
  emitAgentProgress,
  emitAgentCompleted,
  emitArtifactGenerated,
  emitApprovalRequested,
  emitApprovalCompleted,
  emitProjectProgress,
  emitCodeGenStarted,
  emitCodeChunk,
  emitCodeGenCompleted,
};