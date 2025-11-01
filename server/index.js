import app from "./src/app.js";
import { createServer } from "http";
import { initWebSocket } from "./src/services/websocket.js";

const PORT = process.env.PORT || 5000;
const server = createServer(app);

initWebSocket(server);

server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
