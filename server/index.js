import app from "./src/app.js";
import { createServer } from "http";
import { initWebSocket } from "./src/services/websocket.js";

const PORT = process.env.PORT || 5000;
const server = createServer(app);

// Initialize WebSocket with proper configuration
initWebSocket(server);

server.listen(PORT, () => {
  const serverUrl = process.env.NODE_ENV === 'production' 
    ? 'https://pdf2csv-backend-805037964827.us-central1.run.app'
    : `http://localhost:${PORT}`;
  console.log(`✅ Server running on ${serverUrl}`);
});