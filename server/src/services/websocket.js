// server/src/services/websocket.js
import { WebSocketServer } from 'ws';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

let wss;

export const initWebSocket = (server) => {
  const wsPath = config.wsPath || '/ws';
  logger.info(`Initializing WebSocket server (path=${wsPath})`);
  // Let the ws library enforce the path; pass path to the constructor
  wss = new WebSocketServer({ server, path: wsPath });

  wss.on('connection', (ws, req) => {
    logger.info('Client connected via WS path', { path: wsPath });
    ws.on('close', () => {
      logger.info('Client disconnected');
    });
  });
};

export const broadcast = (data) => {
  // Guard if WebSocket server not initialized
  if (!wss || !wss.clients) return;

  // optional debug: log batch events for easier debugging
  try {
    if (data && typeof data.type === 'string' && data.type.startsWith('BATCH_')) {
      logger.debug('Broadcasting batch event', { type: data.type, batchId: data.batchId });
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
        logger.warn('Failed to send WS message to a client', { error: sendErr?.message });
      }
    });
  } catch (e) {
    logger.warn('Error iterating websocket clients', { error: e?.message, stack: e?.stack });
  }
};
