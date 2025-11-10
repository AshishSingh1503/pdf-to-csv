import app from "./src/app.js";
import { createServer } from "http";
import { initWebSocket } from "./src/services/websocket.js";
import logger from "./src/utils/logger.js";
import batchQueueManager from './src/services/batchQueueManager.js';
import { config } from './src/config/index.js';

const PORT = process.env.PORT || 5000;
const server = createServer(app);

const wsPath = process.env.WS_PATH || '/ws';
logger.info(`WebSocket path configured as: ${wsPath}`);
initWebSocket(server);

server.listen(PORT, () => {
  logger.info(`✅ Server running on http://localhost:${PORT}`);
});

// Graceful shutdown handling
let _shuttingDown = false;
const shutdown = async (signal) => {
  try {
    if (_shuttingDown) {
      logger.warn('Second shutdown signal received; forcing exit');
      process.exit(1);
    }
    _shuttingDown = true;
    logger.info(`Received ${signal}; starting graceful shutdown`);

    try {
      const info = batchQueueManager.prepareShutdown();
      logger.info('BatchQueueManager.prepareShutdown result', info);
    } catch (e) {
      logger.warn('Error while preparing queue manager for shutdown', e && e.message);
    }

    // Honor configuration: if graceful shutdown is disabled, close immediately
    try {
      if (!config.enableGracefulShutdown) {
        logger.info('Graceful shutdown disabled by configuration; closing server immediately');
        try {
          server.close(() => {
            logger.info('HTTP server closed (graceful shutdown disabled)');
            process.exit(0);
          });
        } catch (e) {
          logger.error('Error closing HTTP server during immediate shutdown', e && e.message);
          process.exit(1);
        }
        return;
      }
    } catch (e) {
      logger.warn('Error checking graceful shutdown config; proceeding with graceful wait', e && e.message);
    }

    try {
      const timeoutMs = (config && config.gracefulShutdownTimeout) || 300000;
      logger.info(`Waiting up to ${timeoutMs}ms for active batches to finish`);
      await batchQueueManager.waitForActiveBatches(timeoutMs);
      logger.info('Active batches finished during graceful shutdown wait');
    } catch (e) {
      logger.warn('Timeout or error while waiting for active batches to complete', e && (e.remaining !== undefined ? `remaining=${e.remaining}` : e.message));
    }

    // Close HTTP server (this will also stop accepting new connections)
    try {
      server.close(() => {
        logger.info('HTTP server closed, exiting process');
        process.exit(0);
      });
    } catch (e) {
      logger.error('Error closing HTTP server during shutdown', e && e.message);
      process.exit(1);
    }

    // Force exit if the server hasn't closed within the graceful timeout + buffer
    setTimeout(() => {
      logger.error('Forcing process.exit after graceful shutdown timeout');
      process.exit(1);
    }, ((config && config.gracefulShutdownTimeout) || 300000) + 5000);

  } catch (err) {
    logger.error('Unhandled error during shutdown', err && err.message);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
