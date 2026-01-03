// server.js - Рабочий VPN сервер для Render
const net = require('net');
const crypto = require('crypto');
const http = require('http');

// Важно: Render предоставляет порт через переменную окружения PORT
const CONFIG = {
  PORT: process.env.PORT || 3000, // Render использует $PORT
  SECRET_KEY: process.env.VPN_SECRET || 'render-vpn-secret-2024',
  REGION: 'Oregon (US West)',
  HOSTNAME: process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'
};

console.log(`🚀 Запуск VPN сервера на Render (${CONFIG.REGION})`);
console.log(`🌐 Хост: ${CONFIG.HOSTNAME}`);
console.log(`🔌 Порт: ${CONFIG.PORT}`);

// Простой протокол
class SimpleVPN {
  constructor() {
    this.clients = new Map();
    this.server = net.createServer(this.handleConnection.bind(this));
  }

  start() {
    this.server.listen(CONFIG.PORT, '0.0.0.0', () => {
      console.log(`✅ VPN сервер запущен на порту ${CONFIG.PORT}`);
      console.log(`🔗 Для подключения: ${CONFIG.HOSTNAME}:${CONFIG.PORT}`);
    });

    this.server.on('error', (err) => {
      console.error('❌ Ошибка сервера:', err.message);
    });
  }

  handleConnection(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`🔌 Новое подключение: ${clientId}`);
    
    // Приветственное сообщение
    socket.write(`HELLO VPN ${CONFIG.REGION}\n`);
    socket.write(`SERVER ${CONFIG.HOSTNAME}\n`);
    socket.write(`TIME ${new Date().toISOString()}\n`);
    socket.write(`READY\n\n`);

    socket.on('data', (data) => {
      const message = data.toString().trim();
      console.log(`📨 ${clientId}: ${message}`);
      
      // Обработка команд
      if (message === 'PING') {
        socket.write('PONG ' + Date.now() + '\n');
      } else if (message === 'STATS') {
        socket.write(`STATS CLIENTS:${this.clients.size} UPTIME:${process.uptime()}\n`);
      } else if (message === 'EXIT') {
        socket.write('GOODBYE\n');
        socket.end();
      } else {
        socket.write(`ECHO: ${message}\n`);
      }
    });

    socket.on('error', (err) => {
      console.log(`⚠️ ${clientId} ошибка:`, err.message);
    });

    socket.on('close', () => {
      console.log(`🔌 Отключен: ${clientId}`);
    });

    // Сохраняем клиента
    this.clients.set(clientId, {
      socket: socket,
      connectedAt: new Date()
    });
  }
}

// HTTP сервер для health check (обязательно для Render)
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'vpn-server',
      region: CONFIG.REGION,
      uptime: process.uptime(),
      clients: Array.from(vpnServer.clients.keys()).length,
      timestamp: new Date().toISOString()
    }));
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>VPN Server ${CONFIG.REGION}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          .container { max-width: 600px; margin: 0 auto; }
          h1 { color: #333; }
          .status { background: #e8f5e9; padding: 15px; border-radius: 5px; }
          code { background: #f5f5f5; padding: 2px 5px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 VPN Server ${CONFIG.REGION}</h1>
          <div class="status">
            <p><strong>Status:</strong> ✅ Active</p>
            <p><strong>Host:</strong> ${CONFIG.HOSTNAME}</p>
            <p><strong>Port:</strong> ${CONFIG.PORT}</p>
            <p><strong>Region:</strong> ${CONFIG.REGION}</p>
          </div>
          <h3>How to connect:</h3>
          <p>Use this command:</p>
          <code>node client.js ${CONFIG.HOSTNAME} ${CONFIG.PORT}</code>
          <h3>Endpoints:</h3>
          <ul>
            <li><a href="/health">/health</a> - Health check</li>
          </ul>
        </div>
      </body>
      </html>
    `);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// Запуск серверов
const vpnServer = new SimpleVPN();
vpnServer.start();

// HTTP сервер слушает на том же порту (для Render)
httpServer.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP сервер запущен на порту ${CONFIG.PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down...');
  process.exit(0);
});
