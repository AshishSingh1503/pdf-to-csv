// client/src/services/websocket.js
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5000/ws';

// Simple WebSocket + PubSub wrapper with a small in-memory buffer keyed by batchId
class WebsocketService {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.listeners = new Set();
    // buffer of recent events (Map<batchId, Array<event>>)
    this.buffer = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000; // 30s
    this.reconnectTimer = null;
    this.shouldReconnect = true;
    this.connect();
  }

  connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('open', () => {
      console.log('WebSocket connected');
      // reset backoff
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      // notify listeners that we've reconnected so they can optionally refresh
      const reconMsg = { type: 'WS_RECONNECTED', timestamp: new Date().toISOString() };
      for (const l of Array.from(this.listeners)) {
        try { l({ data: JSON.stringify(reconMsg) }); } catch (err) { console.warn('ws listener error', err); }
      }
    });

    this.socket.addEventListener('close', () => {
      console.log('WebSocket disconnected');
      if (!this.shouldReconnect) return;
      // exponential backoff
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
      this.reconnectAttempts += 1;
      console.log(`WebSocket attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, delay);
    });

    this.socket.addEventListener('error', (err) => {
      console.warn('WebSocket error', err);
      try { this.socket.close(); } catch (closeErr) { console.warn('Error closing WebSocket', closeErr); }
    });

    this.socket.addEventListener('message', (evt) => this._onMessage(evt));
  }

  _onMessage(evt) {
    let parsed;
    try {
      parsed = JSON.parse(evt.data);
    } catch {
      // pass raw through
      parsed = evt.data;
    }

    // buffer message by batchId if available
    const batchId = parsed && (parsed.batchId ?? parsed.batch_id);
    if (batchId) {
      const arr = this.buffer.get(batchId) || [];
      arr.unshift({ ts: Date.now(), msg: parsed });
      // keep last 50 messages per batch
      this.buffer.set(batchId, arr.slice(0, 50));
    }

    // also buffer by collectionId for quick hydration
    const collectionId = parsed && parsed.collectionId;
    if (collectionId !== undefined && collectionId !== null) {
      const colKey = `col:${collectionId}`;
      const arr = this.buffer.get(colKey) || [];
      arr.unshift({ ts: Date.now(), msg: parsed });
      this.buffer.set(colKey, arr.slice(0, 100));
    }

    // notify listeners
    for (const l of Array.from(this.listeners)) {
      try { l({ data: JSON.stringify(parsed) }); } catch (err) { console.warn('ws listener error', err); }
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
  }

  unsubscribe(fn) {
    this.listeners.delete(fn);
  }

  getBufferedEvents(batchId) {
    return this.buffer.get(batchId) || [];
  }

  // return buffered events relevant to a collection id
  getBufferedEventsForCollection(collectionId) {
    if (collectionId === undefined || collectionId === null) return [];
    const colKey = `col:${collectionId}`;
    return this.buffer.get(colKey) || [];
  }
}

const wsService = new WebsocketService(WS_URL);

export default wsService;
