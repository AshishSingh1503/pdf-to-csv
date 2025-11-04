// client/src/services/websocket.js
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5000';
const socket = new WebSocket(WS_URL);

socket.onopen = () => {
  console.log('WebSocket connected');
};

socket.onclose = () => {
  console.log('WebSocket disconnected');
};

export default socket;
