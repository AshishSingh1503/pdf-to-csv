// client/src/services/websocket.js
const socket = new WebSocket('ws://localhost:5000');

socket.onopen = () => {
  console.log('WebSocket connected');
};

socket.onclose = () => {
  console.log('WebSocket disconnected');
};

export default socket;
