// server.js - WebSocket VPN сервер для Render
const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'vpn-ws-server',
    region: 'Oregon (US West)',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    clients: wsServer ? wsServer.clients.size : 0
  });
});

// Main page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WebSocket VPN Server - Oregon</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .container { max-width: 800px; margin: 0 auto; }
        .status { background: #e8f5e9; padding: 20px; border-radius: 5px; }
        code { background: #f5f5f5; padding: 2px 5px; border-radius: 3px; }
        .client-box { margin-top: 30px; border: 1px solid #ddd; padding: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 WebSocket VPN Server</h1>
        <div class="status">
          <p><strong>Status:</strong> ✅ Active</p>
          <p><strong>Region:</strong> Oregon (US West)</p>
          <p><strong>URL:</strong> wss://${req.hostname}/vpn</p>
          <p><strong>Clients:</strong> <span id="clientCount">0</span></p>
        </div>
        
        <h3>WebSocket Test Client:</h3>
        <div class="client-box">
          <p>Connect to: <code>wss://${req.hostname}/vpn</code></p>
          <button onclick="connectWebSocket()">Connect</button>
          <button onclick="sendPing()">Send PING</button>
          <button onclick="disconnect()">Disconnect</button>
          <div id="output" style="margin-top: 10px; height: 200px; overflow-y: scroll; border: 1px solid #ccc; padding: 10px;"></div>
        </div>
        
        <h3>Node.js Client:</h3>
        <pre><code>const WebSocket = require('ws');
const ws = new WebSocket('wss://${req.hostname}/vpn');

ws.on('open', () => {
  console.log('Connected to VPN server');
  ws.send(JSON.stringify({type: 'auth', token: 'client123'}));
});

ws.on('message', (data) => {
  console.log('Server:', JSON.parse(data.toString()));
});</code></pre>
      </div>
      
      <script>
        let ws = null;
        const output = document.getElementById('clientCount');
        
        function connectWebSocket() {
          if (ws && ws.readyState === WebSocket.OPEN) {
            log('Already connected');
            return;
          }
          
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = protocol + '//' + window.location.host + '/vpn';
          
          ws = new WebSocket(wsUrl);
          
          ws.onopen = () => {
            log('✅ Connected to VPN server');
            updateClientCount();
            // Send authentication
            ws.send(JSON.stringify({
              type: 'auth',
              client: 'web-browser',
              token: 'web-client-123'
            }));
          };
          
          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              log('📨 Server: ' + JSON.stringify(data, null, 2));
              updateClientCount();
            } catch (e) {
              log('📨 Server: ' + event.data);
            }
          };
          
          ws.onerror = (error) => {
            log('❌ WebSocket error: ' + error.message);
          };
          
          ws.onclose = () => {
            log('🔌 Disconnected from server');
            updateClientCount();
          };
        }
        
        function sendPing() {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'ping',
              timestamp: Date.now()
            }));
          } else {
            log('Not connected');
          }
        }
        
        function disconnect() {
          if (ws) {
            ws.close();
            ws = null;
          }
        }
        
        function log(message) {
          const outputDiv = document.getElementById('output');
          outputDiv.innerHTML += '<div>' + message + '</div>';
          outputDiv.scrollTop = outputDiv.scrollHeight;
        }
        
        function updateClientCount() {
          fetch('/health')
            .then(r => r.json())
            .then(data => {
              output.textContent = data.clients || 0;
            });
        }
        
        // Auto-update client count every 5 seconds
        setInterval(updateClientCount, 5000);
        updateClientCount();
      </script>
    </body>
    </html>
  `);
});

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`🚀 HTTP server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

// WebSocket server
const wsServer = new WebSocket.Server({ 
  server,
  path: '/vpn'
});

// Store connected clients
const clients = new Map();

wsServer.on('connection', (ws, req) => {
  const clientId = crypto.randomBytes(8).toString('hex');
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  console.log(`🔌 New WebSocket connection: ${clientId} from ${clientIp}`);
  
  const clientInfo = {
    id: clientId,
    ws: ws,
    ip: clientIp,
    connectedAt: new Date(),
    authenticated: false
  };
  
  clients.set(clientId, clientInfo);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Welcome to Oregon VPN Server',
    clientId: clientId,
    server: 'vpn-server-o.onrender.com',
    region: 'Oregon (US West)',
    timestamp: new Date().toISOString()
  }));
  
  // Handle messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleClientMessage(clientId, message);
    } catch (error) {
      console.log(`📨 Raw message from ${clientId}: ${data.toString().substring(0, 100)}`);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid JSON format'
      }));
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log(`🔌 Client disconnected: ${clientId}`);
    clients.delete(clientId);
  });
  
  ws.on('error', (error) => {
    console.log(`⚠️ Error with client ${clientId}: ${error.message}`);
  });
});

function handleClientMessage(clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;
  
  console.log(`📨 Message from ${clientId}: ${message.type}`);
  
  switch (message.type) {
    case 'auth':
      // Simple authentication
      if (message.token === 'client123' || message.token === 'web-client-123') {
        client.authenticated = true;
        client.ws.send(JSON.stringify({
          type: 'auth_response',
          status: 'authenticated',
          clientId: clientId,
          timestamp: new Date().toISOString()
        }));
        console.log(`✅ Client authenticated: ${clientId}`);
      } else {
        client.ws.send(JSON.stringify({
          type: 'auth_response',
          status: 'failed',
          message: 'Invalid token'
        }));
      }
      break;
      
    case 'ping':
      client.ws.send(JSON.stringify({
        type: 'pong',
        timestamp: Date.now(),
        serverTime: new Date().toISOString(),
        originalTimestamp: message.timestamp
      }));
      break;
      
    case 'echo':
      client.ws.send(JSON.stringify({
        type: 'echo_response',
        message: message.text || 'No text provided',
        timestamp: new Date().toISOString(),
        receivedAt: Date.now()
      }));
      break;
      
    case 'stats':
      const stats = {
        type: 'stats_response',
        server: {
          region: 'Oregon (US West)',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          clients: clients.size,
          authenticatedClients: Array.from(clients.values()).filter(c => c.authenticated).length
        },
        client: {
          id: clientId,
          connectedFor: Date.now() - client.connectedAt.getTime(),
          authenticated: client.authenticated
        },
        timestamp: new Date().toISOString()
      };
      client.ws.send(JSON.stringify(stats));
      break;
      
    default:
      client.ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${message.type}`,
        availableTypes: ['auth', 'ping', 'echo', 'stats']
      }));
  }
}

// Update client count periodically
setInterval(() => {
  wsServer.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'heartbeat',
        timestamp: Date.now(),
        serverTime: new Date().toISOString()
      }));
    }
  });
}, 30000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
