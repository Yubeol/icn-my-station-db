import { getLiveUrl, type LiveMessage, type LiveTopic } from './client';

type MessageHandler = (message: LiveMessage) => void;
type ConnectionHandler = (connected: boolean) => void;

const messageHandlers = new Set<MessageHandler>();
const connectionHandlers = new Set<ConnectionHandler>();
const topics = new Set<LiveTopic>(['congestion', 'flights', 'stats', 'alerts', 'weather']);

let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let connected = false;

function notifyConnection(value: boolean) {
  connected = value;
  connectionHandlers.forEach(handler => handler(value));
}

function stopRetry() {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function closeWhenUnused() {
  if (messageHandlers.size || connectionHandlers.size) return;
  stopRetry();
  retryCount = 0;
  const previous = socket;
  socket = null;
  previous?.close();
  connected = false;
}

function connect() {
  if (!messageHandlers.size && !connectionHandlers.size) return;
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  stopRetry();

  const ws = new WebSocket(getLiveUrl());
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return;
    retryCount = 0;
    notifyConnection(true);
    console.info('[WS] 연결됨');
  };

  ws.onmessage = event => {
    if (socket !== ws) return;
    try {
      const raw: unknown = JSON.parse(String(event.data));
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
      const obj = raw as Record<string, unknown>;
      if (typeof obj.topic !== 'string' || !topics.has(obj.topic as LiveTopic)) return;
      if (!('data' in obj)) return;
      if (obj.scope !== null && obj.scope !== undefined && typeof obj.scope !== 'string') return;
      const message: LiveMessage = {
        topic: obj.topic as LiveTopic,
        scope: (obj.scope as string | null | undefined) ?? null,
        data: obj.data,
        sentAt: typeof obj.sentAt === 'string' ? obj.sentAt : '',
      };
      messageHandlers.forEach(handler => handler(message));
    } catch (error) {
      console.warn('[WS] 메시지 해석 실패', error);
    }
  };

  ws.onerror = () => console.warn('[WS] 연결 오류');
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    notifyConnection(false);
    if (!messageHandlers.size && !connectionHandlers.size) return;
    const delay = Math.min(1000 * 2 ** retryCount, 30000);
    retryCount = Math.min(retryCount + 1, 5);
    retryTimer = setTimeout(connect, delay);
    console.info(`[WS] ${delay}ms 뒤 재연결`);
  };
}

export function subscribeLive(handler: MessageHandler): () => void {
  messageHandlers.add(handler);
  connect();
  return () => {
    messageHandlers.delete(handler);
    closeWhenUnused();
  };
}

export function subscribeLiveConnection(handler: ConnectionHandler): () => void {
  connectionHandlers.add(handler);
  handler(connected);
  connect();
  return () => {
    connectionHandlers.delete(handler);
    closeWhenUnused();
  };
}
