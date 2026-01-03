// server.js - Полноценный VPN сервер через WebSockets
const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');
const net = require('net');
const dgram = require('dgram');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Хранилище клиентов и туннелей
const clients = new Map();
const tunnels = new Map();

// Генерация ключа шифрования
const ENCRYPTION_KEY = process.env.VPN_SECRET || crypto.randomBytes(32).toString('hex');

// Шифрование данных
class VPNEncryption {
  static encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', 
      crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(), 
      iv
    );
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  }

  static decrypt(data) {
    try {
      const iv = data.slice(0, 16);
      const authTag = data.slice(16, 32);
      const encrypted = data.slice(32);
      
      const decipher = crypto.createDecipheriv('aes-256-gcm',
        crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(),
        iv
      );
      decipher.setAuthTag(authTag);
      
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch (error) {
      return null;
    }
  }
}

// TCP туннель для пересылки трафика
class TCPTunnel {
  constructor(clientId, targetHost, targetPort, clientWs) {
    this.clientId = clientId;
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.clientWs = clientWs;
    this.tcpSocket = null;
    this.tunnelId = crypto.randomBytes(8).toString('hex');
    
    this.connect();
  }
  
  connect() {
    this.tcpSocket = net.createConnection({
      host: this.targetHost,
      port: this.targetPort
    }, () => {
      console.log(`🔗 Туннель ${this.tunnelId} подключен к ${this.targetHost}:${this.targetPort}`);
      
      // Отправляем клиенту подтверждение
      this.clientWs.send(JSON.stringify({
        type: 'tunnel_open',
        tunnelId: this.tunnelId,
        target: `${this.targetHost}:${this.targetPort}`
      }));
    });
    
    this.tcpSocket.on('data', (data) => {
      // Шифруем и отправляем данные клиенту
      const encrypted = VPNEncryption.encrypt(data);
      this.clientWs.send(JSON.stringify({
        type: 'tunnel_data',
        tunnelId: this.tunnelId,
        data: encrypted.toString('base64')
      }));
    });
    
    this.tcpSocket.on('error', (error) => {
      console.log(`❌ Ошибка туннеля ${this.tunnelId}:`, error.message);
      this.close();
    });
    
    this.tcpSocket.on('close', () => {
      console.log(`🔌 Туннель ${this.tunnelId} закрыт`);
      this.close();
    });
  }
  
  send(data) {
    if (this.tcpSocket && !this.tcpSocket.destroyed) {
      this.tcpSocket.write(data);
    }
  }
  
  close() {
    if (this.tcpSocket) {
      this.tcpSocket.destroy();
    }
    tunnels.delete(this.tunnelId);
    
    // Уведомляем клиента
    this.clientWs.send(JSON.stringify({
      type: 'tunnel_close',
      tunnelId: this.tunnelId
    }));
  }
}

// HTTP endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'full-vpn-server',
    region: 'Oregon (US West)',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    clients: clients.size,
    tunnels: tunnels.size,
    encryption: 'AES-256-GCM'
  });
});

app.get('/stats', (req, res) => {
  const clientList = Array.from(clients.values()).map(client => ({
    id: client.id,
    ip: client.ip,
    connectedAt: client.connectedAt,
    authenticated: client.authenticated,
    tunnels: client.tunnels || []
  }));
  
  res.json({
    server: {
      region: 'Oregon (US West)',
      hostname: process.env.RENDER_EXTERNAL_HOSTNAME || req.hostname,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    },
    clients: clientList,
    activeTunnels: tunnels.size
  });
});

app.get('/client.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
    // WebSocket VPN клиент для браузера
    class BrowserVPNClient {
      constructor(serverUrl) {
        this.serverUrl = serverUrl || 'wss://' + window.location.host + '/vpn';
        this.ws = null;
        this.connected = false;
        this.clientId = null;
        this.tunnels = new Map();
      }
      
      connect() {
        return new Promise((resolve, reject) => {
          this.ws = new WebSocket(this.serverUrl);
          
          this.ws.onopen = () => {
            this.connected = true;
            resolve();
          };
          
          this.ws.onmessage = (event) => {
            this.handleMessage(JSON.parse(event.data));
          };
          
          this.ws.onerror = reject;
          this.ws.onclose = () => {
            this.connected = false;
          };
        });
      }
      
      handleMessage(message) {
        console.log('VPN:', message);
        // Здесь будет обработка сообщений
      }
      
      authenticate(token) {
        this.send({
          type: 'auth',
          token: token
        });
      }
      
      send(data) {
        if (this.connected) {
          this.ws.send(JSON.stringify(data));
        }
      }
    }
    
    // Экспорт для использования
    window.VPNClient = BrowserVPNClient;
  `);
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Full VPN Server - Oregon</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .container { max-width: 1000px; margin: 0 auto; }
        .panel { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .status { background: #e8f5e9; }
        .controls { background: #e3f2fd; }
        code { background: #fff; padding: 2px 5px; border-radius: 3px; }
        button { margin: 5px; padding: 8px 15px; background: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #1976D2; }
        .log { background: #000; color: #0f0; padding: 10px; font-family: monospace; height: 300px; overflow-y: scroll; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 Full VPN Server - Oregon (US West)</h1>
        
        <div class="panel status">
          <h3>Server Status</h3>
          <p><strong>URL:</strong> <code id="serverUrl">wss://${req.hostname}/vpn</code></p>
          <p><strong>Clients:</strong> <span id="clientCount">0</span></p>
          <p><strong>Tunnels:</strong> <span id="tunnelCount">0</span></p>
          <p><strong>Encryption:</strong> AES-256-GCM</p>
        </div>
        
        <div class="panel controls">
          <h3>VPN Controls</h3>
          <button onclick="connectVPN()">Connect VPN</button>
          <button onclick="disconnectVPN()">Disconnect</button>
          <button onclick="createTunnel()">Create Tunnel to Google</button>
          <button onclick="testPing()">Test Ping</button>
        </div>
        
        <div class="panel">
          <h3>Log</h3>
          <div id="log" class="log"></div>
        </div>
        
        <div class="panel">
          <h3>Node.js Client Example</h3>
          <pre><code>const VPNClient = require('./client.js');
const client = new VPNClient('wss://${req.hostname}/vpn');

await client.connect();
await client.authenticate('your-token');
await client.createTunnel('google.com', 80);</code></pre>
        </div>
      </div>
      
      <script src="/client.js"></script>
      <script>
        let vpnClient = null;
        
        function log(message) {
          const logDiv = document.getElementById('log');
          logDiv.innerHTML += '> ' + message + '\\n';
          logDiv.scrollTop = logDiv.scrollHeight;
        }
        
        async function connectVPN() {
          try {
            vpnClient = new VPNClient();
            await vpnClient.connect();
            log('✅ Connected to VPN server');
            vpnClient.authenticate('browser-client');
            updateStats();
          } catch (error) {
            log('❌ Connection failed: ' + error.message);
          }
        }
        
        function disconnectVPN() {
          if (vpnClient && vpnClient.ws) {
            vpnClient.ws.close();
            log('🔌 Disconnected from VPN');
          }
        }
        
        function createTunnel() {
          if (vpnClient && vpnClient.connected) {
            vpnClient.send({
              type: 'create_tunnel',
              targetHost: 'www.google.com',
              targetPort: 80
            });
            log('🔄 Creating tunnel to google.com:80');
          }
        }
        
        function testPing() {
          if (vpnClient && vpnClient.connected) {
            vpnClient.send({
              type: 'ping',
              timestamp: Date.now()
            });
            log('🏓 Sending ping...');
          }
        }
        
        function updateStats() {
          fetch('/stats')
            .then(r => r.json())
            .then(data => {
              document.getElementById('clientCount').textContent = data.clients.length;
              document.getElementById('tunnelCount').textContent = data.activeTunnels;
            });
        }
        
        // Auto-update stats
        setInterval(updateStats, 3000);
        updateStats();
      </script>
    </body>
    </html>
  `);
});

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`🚀 Full VPN server running on port ${PORT}`);
  console.log(`🌐 Web interface: http://localhost:${PORT}`);
  console.log(`🔗 WebSocket endpoint: ws://localhost:${PORT}/vpn`);
  console.log(`🔒 Encryption key: ${ENCRYPTION_KEY.substring(0, 16)}...`);
});

// WebSocket server
const wss = new WebSocket.Server({ server, path: '/vpn' });

wss.on('connection', (ws, req) => {
  const clientId = crypto.randomBytes(8).toString('hex');
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  console.log(`🔌 New VPN client: ${clientId} from ${clientIp}`);
  
  const clientInfo = {
    id: clientId,
    ws: ws,
    ip: clientIp,
    connectedAt: new Date(),
    authenticated: false,
    tunnels: []
  };
  
  clients.set(clientId, clientInfo);
  
  // Send welcome with encryption info
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId: clientId,
    server: 'full-vpn-oregon',
    region: 'Oregon (US West)',
    encryption: 'AES-256-GCM',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      stats: '/stats'
    }
  }));
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleClientMessage(clientId, message);
    } catch (error) {
      console.log(`❌ Invalid message from ${clientId}:`, error.message);
    }
  });
  
  ws.on('close', () => {
    console.log(`🔌 VPN client disconnected: ${clientId}`);
    
    // Close all tunnels for this client
    clientInfo.tunnels.forEach(tunnelId => {
      const tunnel = tunnels.get(tunnelId);
      if (tunnel) {
        tunnel.close();
      }
    });
    
    clients.delete(clientId);
  });
  
  ws.on('error', (error) => {
    console.log(`⚠️ WebSocket error for ${clientId}:`, error.message);
  });
});

async function handleClientMessage(clientId, message) {
  const client = clients.get(clientId);
  if (!client || !client.ws) return;
  
  console.log(`📨 [${clientId}] ${message.type}`);
  
  switch (message.type) {
    case 'auth':
      // Simple token-based authentication
      const validTokens = ['client123', 'browser-client', 'vpn-user'];
      if (validTokens.includes(message.token)) {
        client.authenticated = true;
        client.ws.send(JSON.stringify({
          type: 'auth_success',
          clientId: clientId,
          permissions: ['create_tunnel', 'ping', 'stats']
        }));
      } else {
        client.ws.send(JSON.stringify({
          type: 'auth_failed',
          reason: 'Invalid token'
        }));
      }
      break;
      
    case 'ping':
      client.ws.send(JSON.stringify({
        type: 'pong',
        timestamp: message.timestamp,
        serverTime: Date.now(),
        latency: Date.now() - message.timestamp
      }));
      break;
      
    case 'create_tunnel':
      if (!client.authenticated) {
        client.ws.send(JSON.stringify({
          type: 'error',
          message: 'Authentication required'
        }));
        return;
      }
      
      try {
        const { targetHost, targetPort } = message;
        const tunnel = new TCPTunnel(clientId, targetHost, parseInt(targetPort), client.ws);
        
        tunnels.set(tunnel.tunnelId, tunnel);
        client.tunnels.push(tunnel.tunnelId);
        
      } catch (error) {
        client.ws.send(JSON.stringify({
          type: 'error',
          message: `Failed to create tunnel: ${error.message}`
        }));
      }
      break;
      
    case 'tunnel_data':
      if (!client.authenticated) return;
      
      const tunnel = tunnels.get(message.tunnelId);
      if (tunnel && tunnel.clientId === clientId) {
        try {
          const data = Buffer.from(message.data, 'base64');
          const decrypted = VPNEncryption.decrypt(data);
          
          if (decrypted) {
            tunnel.send(decrypted);
          }
        } catch (error) {
          console.log(`❌ Tunnel data error: ${error.message}`);
        }
      }
      break;
      
    case 'close_tunnel':
      if (!client.authenticated) return;
      
      const tunnelToClose = tunnels.get(message.tunnelId);
      if (tunnelToClose && tunnelToClose.clientId === clientId) {
        tunnelToClose.close();
        
        // Remove from client's tunnel list
        client.tunnels = client.tunnels.filter(id => id !== message.tunnelId);
      }
      break;
      
    case 'stats':
      const clientTunnels = client.tunnels.map(id => {
        const t = tunnels.get(id);
        return t ? { id: t.tunnelId, target: `${t.targetHost}:${t.targetPort}` } : null;
      }).filter(Boolean);
      
      client.ws.send(JSON.stringify({
        type: 'client_stats',
        clientId: clientId,
        connectedAt: client.connectedAt,
        authenticated: client.authenticated,
        tunnels: clientTunnels,
        serverStats: {
          totalClients: clients.size,
          totalTunnels: tunnels.size,
          uptime: process.uptime()
        }
      }));
      break;
      
    case 'http_proxy':
      if (!client.authenticated) return;
      
      // HTTP проксирование через VPN
      try {
        const { method, url, headers, body } = message;
        const proxyResult = await proxyHttpRequest(method, url, headers, body);
        
        client.ws.send(JSON.stringify({
          type: 'http_response',
          requestId: message.requestId,
          status: proxyResult.status,
          headers: proxyResult.headers,
          body: proxyResult.body.toString('base64')
        }));
      } catch (error) {
        client.ws.send(JSON.stringify({
          type: 'error',
          message: `HTTP proxy failed: ${error.message}`
        }));
      }
      break;
      
    default:
      client.ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown command: ${message.type}`
      }));
  }
}

// HTTP прокси функция
async function proxyHttpRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: headers || {}
    };
    
    const protocol = parsedUrl.protocol === 'https:' ? require('https') : http;
    
    const req = protocol.request(options, (res) => {
      const chunks = [];
      
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(Buffer.from(body, 'base64'));
    }
    
    req.end();
  });
}

// DNS proxy (опционально)
async function dnsLookup(hostname) {
  return new Promise((resolve, reject) => {
    require('dns').lookup(hostname, (err, address) => {
      if (err) reject(err);
      else resolve(address);
    });
  });
}

// Cleanup old tunnels
setInterval(() => {
  const now = Date.now();
  tunnels.forEach((tunnel, tunnelId) => {
    // Close tunnels older than 1 hour
    if (now - tunnel.createdAt > 3600000) {
      tunnel.close();
    }
  });
}, 60000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down VPN server...');
  
  // Close all WebSocket connections
  wss.clients.forEach(client => {
    client.close();
  });
  
  // Close all tunnels
  tunnels.forEach(tunnel => {
    tunnel.close();
  });
  
  server.close(() => {
    console.log('✅ VPN server stopped');
    process.exit(0);
  });
});
