const WS_URL = import.meta.env.VITE_API_URL 
  ? `wss://${new URL(import.meta.env.VITE_API_URL).host}`
  : 'ws://localhost:5000';

const socket = new WebSocket(WS_URL);

socket.onopen = () => {
  console.log('WebSocket connected to:', WS_URL);
};

socket.onclose = () => {
  console.log('WebSocket disconnected');
};

socket.onerror = (error) => {
  console.error('WebSocket error:', error);
};

export default socket;