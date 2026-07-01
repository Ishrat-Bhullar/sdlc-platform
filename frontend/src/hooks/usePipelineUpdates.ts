import { useEffect, useRef, useCallback } from 'react';
import { buildWsUrl } from '../lib/api';

type PipelineEventHandler = (event: { type: string; data: Record<string, unknown> }) => void;

// Accept either a number, string, or a RefObject to support dynamic projectId
type ProjectIdInput = number | string | null | { current: number | string | null };

export function usePipelineUpdates(projectId: ProjectIdInput, onEvent: PipelineEventHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);
  const intentionalDisconnectRef = useRef(false);
  onEventRef.current = onEvent;

  // Helper to get current projectId from ref or value
  const getCurrentProjectId = useCallback(() => {
    if (projectId && typeof projectId === 'object' && 'current' in projectId) {
      return (projectId as { current: number | string | null }).current;
    }
    return projectId as number | string | null;
  }, [projectId]);

  const connect = useCallback(() => {
    const currentProjectId = getCurrentProjectId();
    if (!currentProjectId) return;
    intentionalDisconnectRef.current = false;
    const url = buildWsUrl(`/ws?projectId=${currentProjectId}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        onEventRef.current({ type: msg.event || msg.type || 'message', data: msg.payload || msg });
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      // Only reconnect if not intentionally disconnected
      if (!intentionalDisconnectRef.current) {
        reconnectTimerRef.current = window.setTimeout(() => connect(), 3000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [getCurrentProjectId]);

  useEffect(() => {
    connect();
    return () => {
      // Mark as intentional disconnect to prevent reconnect loop
      intentionalDisconnectRef.current = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
}
