// server.js
const net = require('net');
const crypto = require('crypto');
const http = require('http');

// Конфигурация
const CONFIG = {
  VPN_PORT: process.env.VPN_PORT || 1194,
  ADMIN_PORT: process.env.ADMIN_PORT || 3001,
  REGION: 'Oregon (US West)'
};

// Генерация ключа
const SECRET_KEY = process.env.VPN_SECRET || 'vpn-oregon-secret-key-2024';
const SHARED_KEY = crypto.createHash('sha256').update(SECRET_KEY).digest();

// Логирование
const logger = {
  log: (msg) => console.log(`[${new Date().toISOString()}] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] ERROR: ${msg}`)
};

// Простой шифратор
class SimpleCipher {
  static encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', SHARED_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([iv, encrypted]);
  }

  static decrypt(data) {
    try {
      const iv = data.slice(0, 16);
      const encrypted = data.slice(16);
      const decipher = crypto.createDecipheriv('aes-256-cbc', SHARED_KEY, iv);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch {
      return null;
    }
  }
}

// VPN сервер
class VPNServer {
  constructor() {
    this.clients = new Map();
    this.server = net.createServer(this.handleConnection.bind(this));
  }

  start() {
    this.server.listen(CONFIG.VPN_PORT, '0.0.0.0', () => {
      logger.log(`✅ VPN сервер запущен на порту ${CONFIG.VPN_PORT} (${CONFIG.REGION})`);
      logger.log(`🔑 Ключ шифрования: ${SHARED_KEY.slice(0, 8).toString('hex')}...`);
    });

    this.server.on('error', (err) => {
      logger.error(`Серверная ошибка: ${err.message}`);
    });
  }

  handleConnection(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    
    logger.log(`🔌 Новое подключение: ${clientId}`);
    
    // Отправляем приветственное сообщение
    const welcomeMsg = Buffer.from(`Welcome to Oregon VPN Server\nRegion: ${CONFIG.REGION}\n`);
    const encryptedWelcome = SimpleCipher.encrypt(welcomeMsg);
    socket.write(encryptedWelcome);

    // Настройка обработчиков
    socket.on('data', (data) => {
      this.handleData(socket, clientId, data);
    });

    socket.on('error', (err) => {
      logger.log(`⚠️ Ошибка клиента ${clientId}: ${err.message}`);
    });

    socket.on('close', () => {
      logger.log(`🔌 Отключение: ${clientId}`);
      this.clients.delete(clientId);
    });

    socket.on('end', () => {
      logger.log(`🔌 Клиент ${clientId} завершил соединение`);
    });

    // Сохраняем клиента
    this.clients.set(clientId, {
      socket: socket,
      connectedAt: new Date(),
      bytesReceived: 0,
      bytesSent: 0
    });
  }

  handleData(socket, clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.bytesReceived += data.length;

    // Дешифруем данные
    const decrypted = SimpleCipher.decrypt(data);
    
    if (!decrypted) {
      logger.error(`❌ Ошибка дешифрования от ${clientId}`);
      return;
    }

    // Логируем полученное сообщение
    const message = decrypted.toString().trim();
    logger.log(`📨 От ${clientId}: "${message}" (${data.length} байт)`);

    // Формируем ответ
    const response = Buffer.from(`✅ Получено: "${message}"\n🕒 Время сервера: ${new Date().toISOString()}\n`);
    const encryptedResponse = SimpleCipher.encrypt(response);
    
    socket.write(encryptedResponse);
    client.bytesSent += encryptedResponse.length;

    // Если клиент отправил "exit", закрываем соединение
    if (message.toLowerCase() === 'exit') {
      logger.log(`👋 Закрытие соединения по запросу от ${clientId}`);
      socket.end();
    }
  }

  getStats() {
    return {
      region: CONFIG.REGION,
      activeClients: this.clients.size,
      totalClients: Array.from(this.clients.values()).map(c => ({
        connectedAt: c.connectedAt,
        bytesReceived: c.bytesReceived,
        bytesSent: c.bytesSent
      })),
      serverTime: new Date().toISOString(),
      uptime: process.uptime()
    };
  }
}

// HTTP сервер для мониторинга
class AdminServer {
  constructor(vpnServer) {
    this.vpnServer = vpnServer;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  start() {
    this.server.listen(CONFIG.ADMIN_PORT, '0.0.0.0', () => {
      logger.log(`🌐 Admin сервер запущен на порту ${CONFIG.ADMIN_PORT}`);
    });
  }

  handleRequest(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'healthy',
        region: CONFIG.REGION,
        timestamp: new Date().toISOString()
      }, null, 2));
    } else if (req.url === '/stats') {
      res.writeHead(200);
      res.end(JSON.stringify(this.vpnServer.getStats(), null, 2));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({
        service: 'Oregon VPN Server',
        endpoints: {
          health: '/health',
          stats: '/stats',
          vpn: `tcp://your-server.onrender.com:${CONFIG.VPN_PORT}`
        },
        documentation: 'Используйте VPN клиент с AES-256-CBC шифрованием'
      }, null, 2));
    }
  }
}

// Тестовый клиент (встроенный для проверки)
class TestClient {
  static async test() {
    return new Promise((resolve) => {
      const socket = net.createConnection(CONFIG.VPN_PORT, '127.0.0.1', () => {
        logger.log('🧪 Тестовый клиент подключен');
        
        // Получаем приветственное сообщение
        socket.once('data', (welcomeData) => {
          const welcome = SimpleCipher.decrypt(welcomeData);
          if (welcome) {
            logger.log(`📨 Сервер: ${welcome.toString().trim()}`);
          }
          
          // Отправляем тестовое сообщение
          const testMsg = Buffer.from('Hello Oregon VPN!');
          const encrypted = SimpleCipher.encrypt(testMsg);
          socket.write(encrypted);
          
          // Получаем ответ
          socket.once('data', (responseData) => {
            const response = SimpleCipher.decrypt(responseData);
            if (response) {
              logger.log(`📨 Ответ сервера: ${response.toString().trim()}`);
            }
            
            // Закрываем соединение
            socket.end();
            logger.log('🧪 Тест завершен успешно');
            resolve(true);
          });
        });
      });
      
      socket.on('error', (err) => {
        logger.error(`Тестовый клиент ошибка: ${err.message}`);
        resolve(false);
      });
    });
  }
}

// Главная функция
async function main() {
  logger.log('🚀 Запуск VPN сервера для Render (Oregon)...');
  
  // Запуск VPN сервера
  const vpnServer = new VPNServer();
  vpnServer.start();
  
  // Запуск админ сервера
  const adminServer = new AdminServer(vpnServer);
  adminServer.start();
  
  // Авто-тест при локальном запуске
  if (process.env.NODE_ENV !== 'production') {
    setTimeout(async () => {
      logger.log('🧪 Запуск автоматического теста...');
      const success = await TestClient.test();
      if (success) {
        logger.log('✅ Сервер работает корректно!');
      } else {
        logger.log('⚠️ Тест не удался, но сервер запущен');
      }
    }, 1000);
  }
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.log('🛑 Получен SIGTERM, завершение работы...');
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    logger.log('🛑 Получен SIGINT, завершение работы...');
    process.exit(0);
  });
}

// Запуск
if (require.main === module) {
  main().catch(err => {
    logger.error(`Ошибка запуска: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { VPNServer, TestClient, CONFIG };
