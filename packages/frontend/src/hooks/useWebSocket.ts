import { useCallback, useEffect, useRef } from 'react';
import type { AppEvent, WsOutgoingMessage } from '@cc-gui/shared';
import { createFrontendLogger } from '../logger';

const log = createFrontendLogger('ws');

// Received messages from server — discriminated union matching WsOutgoingMessage
export type WsMessage = WsOutgoingMessage;

// For legacy consumers that destructure specific shapes
export type { WsOutgoingMessage };

interface UseWebSocketOptions {
  url: string;
  onMessage: (msg: WsMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (event: Event) => void;
}

// ── Module-level shared singleton ──────────────────────────────────────────
// All useWebSocket() instances with the same URL share ONE WebSocket.

interface Listener {
  onMessage: React.MutableRefObject<(msg: WsMessage) => void>;
  onOpen: React.MutableRefObject<(() => void) | undefined>;
  onClose: React.MutableRefObject<(() => void) | undefined>;
  onError: React.MutableRefObject<((event: Event) => void) | undefined>;
}

let sharedWs: WebSocket | null = null;
const sharedListeners = new Set<Listener>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let intentionalClose = false;
let currentUrl = '';

const MAX_RECONNECT = 10;
const BASE_DELAY = 1000;
const MAX_DELAY = 30_000;

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (intentionalClose || sharedListeners.size === 0) return;
  if (reconnectAttempt >= MAX_RECONNECT) {
    log.warn(`giving up after ${MAX_RECONNECT} reconnect attempts`, { maxReconnect: MAX_RECONNECT });
    console.log(`[ws] giving up after ${MAX_RECONNECT} reconnect attempts`);
    return;
  }

  const delay = Math.min(BASE_DELAY * Math.pow(2, reconnectAttempt), MAX_DELAY);
  log.info(`reconnect ${reconnectAttempt + 1}/${MAX_RECONNECT}`, { delayMs: delay });
  console.log(`[ws] reconnect ${reconnectAttempt + 1}/${MAX_RECONNECT} in ${delay}ms`);

  reconnectTimer = setTimeout(() => {
    reconnectAttempt++;
    connectShared();
  }, delay);
}

function connectShared() {
  clearReconnectTimer();

  if (!currentUrl || sharedListeners.size === 0) return;

  // Don't double-connect
  if (sharedWs && (sharedWs.readyState === WebSocket.OPEN || sharedWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  // Close old socket
  if (sharedWs) {
    try { sharedWs.close(); } catch { /* ignore */ }
  }

  intentionalClose = false;

  let ws: WebSocket;
  try {
    ws = new WebSocket(currentUrl);
  } catch (err) {
    log.error('failed to create WebSocket', err instanceof Error ? err : undefined);
    console.error('[ws] failed to create WebSocket:', err);
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    if (sharedWs !== ws) return; // stale socket
    log.info('connected', { listeners: sharedListeners.size });
    console.log(`[ws] connected (${sharedListeners.size} listeners)`);
    reconnectAttempt = 0;
    for (const l of sharedListeners) {
      l.onOpen.current?.();
    }
  });

  ws.addEventListener('message', (event) => {
    if (sharedWs !== ws) return;
    try {
      const msg = JSON.parse(event.data) as WsMessage;
      for (const l of sharedListeners) {
        l.onMessage.current(msg);
      }
    } catch {
      // ignore non-JSON
    }
  });

  ws.addEventListener('error', (event) => {
    if (sharedWs !== ws) return;
    log.warn('socket error event', { listeners: sharedListeners.size });
    console.error(`[ws] error event (listeners: ${sharedListeners.size})`);
    for (const l of sharedListeners) {
      l.onError.current?.(event);
    }
  });

  ws.addEventListener('close', () => {
    if (sharedWs !== ws) return;
    log.info('disconnected', { listeners: sharedListeners.size, intentional: intentionalClose });
    console.log(`[ws] disconnected (${sharedListeners.size} listeners, intentional=${intentionalClose})`);
    for (const l of sharedListeners) {
      l.onClose.current?.();
    }
    if (!intentionalClose) {
      scheduleReconnect();
    }
  });

  sharedWs = ws;
}

function disconnectShared() {
  // Only close the actual socket when the LAST listener is removed
  if (sharedListeners.size === 0 && sharedWs) {
    intentionalClose = true;
    clearReconnectTimer();
    try { sharedWs.close(); } catch { /* ignore */ }
    sharedWs = null;
    reconnectAttempt = 0;
    currentUrl = '';
  }
}

function sendShared(data: unknown) {
  if (sharedWs?.readyState === WebSocket.OPEN) {
    sharedWs.send(JSON.stringify(data));
  }
}

// ── Public hook ────────────────────────────────────────────────────────────

export function useWebSocket({
  url,
  onMessage,
  onOpen,
  onClose,
  onError,
}: UseWebSocketOptions) {
  // Refs to latest callbacks — stable across renders
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const listenerRef = useRef<Listener>({
    onMessage: onMessageRef,
    onOpen: onOpenRef,
    onClose: onCloseRef,
    onError: onErrorRef,
  });

  const connect = useCallback(() => {
    // Register this listener if not already registered
    if (!sharedListeners.has(listenerRef.current)) {
      sharedListeners.add(listenerRef.current);
    }

    // Update URL if needed & connect
    if (currentUrl !== url) {
      // URL changed — close old connection
      if (sharedWs) {
        intentionalClose = true;
        clearReconnectTimer();
        try { sharedWs.close(); } catch { /* ignore */ }
        sharedWs = null;
        reconnectAttempt = 0;
      }
      currentUrl = url;
    }

    connectShared();
  }, [url]);

  const send = useCallback((data: unknown) => {
    sendShared(data);
  }, []);

  const close = useCallback(() => {
    sharedListeners.delete(listenerRef.current);
    disconnectShared();
  }, []);

  // Register on mount, cleanup on unmount
  useEffect(() => {
    // The connect() in ChatPanel's useEffect will call connect() which registers
    // and connects. Here we just ensure cleanup on unmount.
    return () => {
      sharedListeners.delete(listenerRef.current);
      disconnectShared();
    };
  }, []);

  return { connect, send, close };
}
