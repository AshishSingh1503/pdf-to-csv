// server/src/services/websocket.js
import { WebSocketServer } from 'ws';

let wss;

export const initWebSocket = (server) => {
  const wsPath = process.env.WS_PATH || '/ws';
  console.log(`🔌 Initializing WebSocket server (path=${wsPath})`);
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    try {
      const reqPath = req && req.url ? req.url : '';
      if (wsPath && !reqPath.startsWith(wsPath)) {
        console.log('Rejecting WS connection on unexpected path', reqPath);
        try { ws.close(); } catch (e) {}
        return;
      }
    } catch (e) {
      // ignore path checking errors
    }

    console.log('Client connected');
    ws.on('close', () => {
      console.log('Client disconnected');
    });
  });
};

export const broadcast = (data) => {
  // Guard if WebSocket server not initialized
  if (!wss || !wss.clients) return;

  // optional debug: log batch events for easier debugging
  try {
    if (data && typeof data.type === 'string' && data.type.startsWith('BATCH_')) {
      console.log('📡 Broadcasting batch event:', data.type, 'batchId:', data.batchId);
    }
  } catch (e) {
    // ignore logging errors
  }

  try {
    wss.clients.forEach((client) => {
      try {
        if (client.readyState === 1) {
          client.send(JSON.stringify(data));
        }
      } catch (sendErr) {
        console.warn('⚠️  Failed to send WS message to a client:', sendErr && sendErr.message);
      }
    });
  } catch (e) {
    console.warn('⚠️  Error iterating websocket clients:', e && e.message);
  }
};
