// server.js - Гибридный сервер для Render (обрабатывает HTTP и VPN)
const net = require('net');

// Конфигурация
const CONFIG = {
  PORT: parseInt(process.env.PORT) || 3000,
  REGION: 'Oregon (US West)',
  HOSTNAME: process.env.RENDER_EXTERNAL_HOSTNAME || 'vpn-server-o.onrender.com'
};

console.log(`🚀 Запуск гибридного сервера на Render (${CONFIG.REGION})`);
console.log(`🌐 Хост: ${CONFIG.HOSTNAME}`);
console.log(`🔌 Порт: ${CONFIG.PORT}`);

// Определяем, является ли запрос HTTP
function isHttpRequest(data) {
  const str = data.toString();
  return str.startsWith('GET ') || 
         str.startsWith('POST ') || 
         str.startsWith('PUT ') || 
         str.startsWith('DELETE ') ||
         str.startsWith('HEAD ') ||
         str.startsWith('OPTIONS ');
}

// Генерируем HTTP ответ
function createHttpResponse(statusCode, contentType, body) {
  return `HTTP/1.1 ${statusCode} ${getStatusText(statusCode)}\r
Content-Type: ${contentType}\r
Content-Length: ${Buffer.byteLength(body)}\r
Connection: close\r
Access-Control-Allow-Origin: *\r
\r
${body}`;
}

function getStatusText(code) {
  const status = {
    200: 'OK',
    404: 'Not Found'
  };
  return status[code] || 'Unknown';
}

// Обработчик HTTP запросов
class HttpHandler {
  handleRequest(data, socket) {
    const request = data.toString();
    
    // Определяем путь запроса
    let path = '/';
    if (request.startsWith('GET ')) {
      path = request.split(' ')[1];
    } else if (request.startsWith('HEAD ')) {
      path = request.split(' ')[1];
    }
    
    console.log(`🌐 HTTP запрос: ${path}`);
    
    switch(path) {
      case '/':
      case '/health':
        const healthData = JSON.stringify({
          status: 'healthy',
          service: 'vpn-server',
          region: CONFIG.REGION,
          hostname: CONFIG.HOSTNAME,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          protocol: 'TCP/VPN',
          note: 'Use telnet or VPN client to connect'
        }, null, 2);
        
        socket.write(createHttpResponse(200, 'application/json', healthData));
        break;
        
      case '/stats':
        const stats = {
          region: CONFIG.REGION,
          server_time: new Date().toISOString(),
          node_version: process.version,
          memory: process.memoryUsage()
        };
        socket.write(createHttpResponse(200, 'application/json', JSON.stringify(stats, null, 2)));
        break;
        
      case '/info':
        const html = `<!DOCTYPE html>
<html>
<head>
    <title>VPN Server ${CONFIG.REGION}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #333; }
        .status { background: #e8f5e9; padding: 20px; border-radius: 5px; }
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
            <p><strong>Protocol:</strong> TCP (RAW)</p>
            <p><strong>For VPN clients:</strong> Connect directly via TCP</p>
        </div>
        <h3>How to connect:</h3>
        <pre><code># Using telnet:
telnet ${CONFIG.HOSTNAME} ${CONFIG.PORT}

# Using netcat:
nc ${CONFIG.HOSTNAME} ${CONFIG.PORT}

# Using Node.js client:
node client.js ${CONFIG.HOSTNAME} ${CONFIG.PORT}</code></pre>
        
        <h3>Endpoints:</h3>
        <ul>
            <li><a href="/health">/health</a> - Health check</li>
            <li><a href="/stats">/stats</a> - Server statistics</li>
        </ul>
    </div>
</body>
</html>`;
        socket.write(createHttpResponse(200, 'text/html; charset=utf-8', html));
        break;
        
      default:
        socket.write(createHttpResponse(404, 'application/json', 
          JSON.stringify({ error: 'Not Found', path: path })));
    }
    
    // Закрываем соединение после HTTP ответа
    setTimeout(() => socket.end(), 100);
  }
}

// VPN сервер
class VPNServer {
  constructor() {
    this.clients = new Map();
    this.httpHandler = new HttpHandler();
    this.server = net.createServer(this.handleConnection.bind(this));
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`✅ Сервер запущен на порту ${CONFIG.PORT}`);
        console.log(`🔗 Подключение: ${CONFIG.HOSTNAME}:${CONFIG.PORT}`);
        console.log(`🌐 HTTP endpoints: http://${CONFIG.HOSTNAME}/health`);
        console.log(`🔌 VPN connection: telnet ${CONFIG.HOSTNAME} ${CONFIG.PORT}`);
        console.log('========================================');
        resolve();
      });

      this.server.on('error', (err) => {
        console.error('❌ Ошибка сервера:', err.message);
        reject(err);
      });
    });
  }

  handleConnection(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    let isHttpConnection = false;
    
    socket.on('data', (data) => {
      // Проверяем первый пакет - HTTP или VPN
      if (!isHttpConnection) {
        isHttpConnection = isHttpRequest(data);
        
        if (isHttpConnection) {
          console.log(`🌐 HTTP соединение: ${clientId}`);
          this.httpHandler.handleRequest(data, socket);
          return;
        } else {
          console.log(`🔌 VPN соединение: ${clientId}`);
          this.handleVpnConnection(socket, clientId);
        }
      }
      
      // Если это VPN соединение, обрабатываем данные
      if (!isHttpConnection) {
        this.handleVpnData(socket, clientId, data);
      }
    });

    socket.on('error', (err) => {
      if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
        console.log(`⚠️ ${clientId} ошибка: ${err.code}`);
      }
    });

    socket.on('close', () => {
      if (!isHttpConnection) {
        console.log(`🔌 Отключен: ${clientId}`);
        this.clients.delete(clientId);
      }
    });
  }

  handleVpnConnection(socket, clientId) {
    // Приветственное сообщение для VPN клиентов
    socket.write('\n');
    socket.write('╔════════════════════════════════════════╗\n');
    socket.write('║        🚀 VPN SERVER - OREGON         ║\n');
    socket.write('╚════════════════════════════════════════╝\n\n');
    socket.write(`Server: ${CONFIG.HOSTNAME}\n`);
    socket.write(`Region: ${CONFIG.REGION}\n`);
    socket.write(`Time: ${new Date().toLocaleString()}\n`);
    socket.write(`Client: ${clientId}\n\n`);
    socket.write('Available commands:\n');
    socket.write('  HELP    - Show this help\n');
    socket.write('  PING    - Test connection\n');
    socket.write('  TIME    - Server time\n');
    socket.write('  STATS   - Server statistics\n');
    socket.write('  ECHO <text> - Echo back text\n');
    socket.write('  EXIT    - Disconnect\n\n');
    socket.write('VPN> ');

    // Сохраняем клиента
    this.clients.set(clientId, {
      socket: socket,
      connectedAt: new Date(),
      isVpn: true
    });
  }

  handleVpnData(socket, clientId, data) {
    const message = data.toString().trim();
    
    if (!message) {
      socket.write('VPN> ');
      return;
    }
    
    console.log(`📨 VPN [${clientId}]: ${message}`);
    
    const cmd = message.toUpperCase();
    
    switch(cmd) {
      case 'HELP':
        socket.write('\nAvailable commands:\n');
        socket.write('  HELP    - Show this help\n');
        socket.write('  PING    - Test connection\n');
        socket.write('  TIME    - Server time\n');
        socket.write('  STATS   - Server statistics\n');
        socket.write('  ECHO <text> - Echo back text\n');
        socket.write('  EXIT    - Disconnect\n\n');
        break;
        
      case 'PING':
        socket.write(`PONG ${Date.now()}\n`);
        break;
        
      case 'TIME':
        socket.write(`Server time: ${new Date().toISOString()}\n`);
        socket.write(`Local time: ${new Date().toLocaleString()}\n`);
        break;
        
      case 'STATS':
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        
        socket.write('\n=== SERVER STATISTICS ===\n');
        socket.write(`Region: ${CONFIG.REGION}\n`);
        socket.write(`Uptime: ${hours}h ${minutes}m ${seconds}s\n`);
        socket.write(`Active VPN clients: ${Array.from(this.clients.values()).filter(c => c.isVpn).length}\n`);
        socket.write(`Your IP: ${clientId.split(':')[0]}\n`);
        socket.write(`Node.js: ${process.version}\n\n`);
        break;
        
      case 'EXIT':
      case 'QUIT':
        socket.write('\n👋 Goodbye! Connection closed.\n');
        socket.end();
        return;
        
      default:
        if (message.startsWith('ECHO ')) {
          const text = message.substring(5);
          socket.write(`Echo: ${text}\n`);
        } else {
          socket.write(`Command "${message}" not recognized. Type HELP for commands.\n`);
        }
    }
    
    socket.write('VPN> ');
  }
}

// Основная функция
async function main() {
  console.log('========================================');
  console.log('🚀 HYBRID SERVER - HTTP & VPN');
  console.log('📍 REGION:', CONFIG.REGION);
  console.log('========================================');
  
  try {
    const vpnServer = new VPNServer();
    await vpnServer.start();
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('\n🛑 SIGTERM received, shutting down...');
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      console.log('\n🛑 SIGINT received, shutting down...');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    
    if (error.code === 'EADDRINUSE') {
      console.log('\n🔧 Port is busy. Waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('🔄 Retrying...');
      await main(); // Рекурсивный перезапуск
    } else {
      process.exit(1);
    }
  }
}

// Запускаем сервер
if (require.main === module) {
  main();
}

module.exports = { VPNServer, CONFIG };
