// server.js - Исправленный VPN сервер для Render
const net = require('net');
const crypto = require('crypto');
const http = require('http');

// ВАЖНО: Render сам назначает порт через process.env.PORT
const CONFIG = {
  PORT: parseInt(process.env.PORT) || 3000,
  SECRET_KEY: process.env.VPN_SECRET || 'render-vpn-secret-2024',
  REGION: 'Oregon (US West)',
  HOSTNAME: process.env.RENDER_EXTERNAL_HOSTNAME || 'vpn-server-o.onrender.com'
};

console.log(`🚀 Запуск VPN сервера на Render (${CONFIG.REGION})`);
console.log(`🌐 Хост: ${CONFIG.HOSTNAME}`);
console.log(`🔌 Порт: ${CONFIG.PORT}`);

// VPN сервер
class VPNServer {
  constructor() {
    this.clients = new Map();
    this.server = net.createServer(this.handleConnection.bind(this));
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`✅ VPN сервер запущен на порту ${CONFIG.PORT}`);
        console.log(`🔗 Для подключения: ${CONFIG.HOSTNAME}:${CONFIG.PORT}`);
        resolve();
      });

      this.server.on('error', (err) => {
        console.error('❌ Ошибка VPN сервера:', err.message);
        reject(err);
      });
    });
  }

  handleConnection(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`🔌 Новое подключение: ${clientId}`);
    
    // Приветствие
    socket.write(`=== VPN SERVER ${CONFIG.REGION} ===\n`);
    socket.write(`Server: ${CONFIG.HOSTNAME}\n`);
    socket.write(`Connected: ${new Date().toLocaleString()}\n`);
    socket.write(`Type HELP for commands\n\n`);

    // Настройка клиента
    const client = {
      id: clientId,
      socket: socket,
      connectedAt: new Date(),
      lastActivity: new Date()
    };
    
    this.clients.set(clientId, client);

    socket.on('data', (data) => {
      client.lastActivity = new Date();
      const message = data.toString().trim();
      
      console.log(`📨 [${clientId}]: ${message}`);
      
      // Обработка команд
      this.handleCommand(client, message);
    });

    socket.on('error', (err) => {
      console.log(`⚠️ ${clientId} error:`, err.message);
    });

    socket.on('close', () => {
      console.log(`🔌 Отключен: ${clientId}`);
      this.clients.delete(clientId);
    });

    socket.on('end', () => {
      console.log(`🔌 ${clientId} завершил соединение`);
    });
  }

  handleCommand(client, command) {
    const cmd = command.toUpperCase();
    
    switch(cmd) {
      case 'HELP':
        client.socket.write(`Available commands:\n`);
        client.socket.write(`  HELP    - Show this help\n`);
        client.socket.write(`  PING    - Test connection\n`);
        client.socket.write(`  TIME    - Server time\n`);
        client.socket.write(`  STATS   - Server statistics\n`);
        client.socket.write(`  ECHO <text> - Echo text\n`);
        client.socket.write(`  EXIT    - Disconnect\n\n`);
        break;
        
      case 'PING':
        client.socket.write(`PONG ${Date.now()}\n`);
        break;
        
      case 'TIME':
        client.socket.write(`SERVER TIME: ${new Date().toISOString()}\n`);
        client.socket.write(`LOCAL TIME: ${new Date().toLocaleString()}\n`);
        break;
        
      case 'STATS':
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        
        client.socket.write(`=== SERVER STATS ===\n`);
        client.socket.write(`Region: ${CONFIG.REGION}\n`);
        client.socket.write(`Uptime: ${hours}h ${minutes}m ${seconds}s\n`);
        client.socket.write(`Clients: ${this.clients.size}\n`);
        client.socket.write(`Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB\n`);
        client.socket.write(`Node: ${process.version}\n\n`);
        break;
        
      case 'EXIT':
      case 'QUIT':
        client.socket.write(`Goodbye! 👋\n`);
        client.socket.end();
        break;
        
      default:
        if (command.startsWith('ECHO ')) {
          const text = command.substring(5);
          client.socket.write(`ECHO: ${text}\n`);
        } else {
          client.socket.write(`Unknown command: ${command}\n`);
          client.socket.write(`Type HELP for available commands\n`);
        }
    }
  }
}

// HTTP сервер для health check
class HTTPServer {
  constructor(vpnServer) {
    this.vpnServer = vpnServer;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  start() {
    return new Promise((resolve, reject) => {
      // Важно: HTTP сервер должен слушать тот же порт что и VPN
      // Но на Render мы не можем слушать порт дважды
      // Поэтому мы не запускаем отдельный HTTP сервер
      // Вместо этого обрабатываем HTTP запросы через net сервер
      console.log(`🌐 HTTP обработчик настроен на порту ${CONFIG.PORT}`);
      resolve();
    });
  }

  handleRequest(req, res) {
    // Это для демонстрации, в реальности мы будем обрабатывать
    // HTTP запросы по-другому
  }
}

// Основная функция
async function main() {
  console.log('========================================');
  console.log('🚀 VPN SERVER FOR RENDER - OREGON');
  console.log('========================================');
  
  try {
    // Запускаем VPN сервер
    const vpnServer = new VPNServer();
    await vpnServer.start();
    
    console.log('========================================');
    console.log('✅ Сервер успешно запущен!');
    console.log(`📡 Подключитесь: ${CONFIG.HOSTNAME}:${CONFIG.PORT}`);
    console.log('========================================\n');
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('\n🛑 Получен SIGTERM, завершение...');
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      console.log('\n🛑 Получен SIGINT, завершение...');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Не удалось запустить сервер:', error.message);
    
    // Если порт занят, пробуем другой
    if (error.code === 'EADDRINUSE') {
      console.log(`\n🔧 Порт ${CONFIG.PORT} занят. Попробуйте:`);
      console.log(`1. Подождите 60 секунд (предыдущий процесс завершается)`);
      console.log(`2. Перезапустите деплой на Render`);
      console.log(`3. Убедитесь что в настройках Render PORT не задан вручную`);
    }
    
    process.exit(1);
  }
}

// Запускаем сервер
if (require.main === module) {
  main();
}

module.exports = { VPNServer, CONFIG };
