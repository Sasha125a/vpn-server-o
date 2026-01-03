// server.js
const net = require('net');
const dgram = require('dgram');
const crypto = require('crypto');
const http = require('http');

// Конфигурация сервера
const CONFIG = {
  PORT: process.env.PORT || 3000,
  VPN_PORT: process.env.VPN_PORT || 1194,
  ADMIN_PORT: process.env.ADMIN_PORT || 3001,
  VPN_PROTOCOL: process.env.VPN_PROTOCOL || 'tcp',
  REGION: 'Oregon (US West)',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// Генерация постоянного ключа (для демонстрации)
const SECRET_KEY = process.env.VPN_SECRET || 'demo-secret-key-for-vpn-oregon-123';
const SERVER_KEY = crypto.createHash('sha256').update(SECRET_KEY + '-server').digest();
const CLIENT_KEY = crypto.createHash('sha256').update(SECRET_KEY + '-client').digest();

// Хранилище клиентов
const clients = new Map();

// Логирование
const logger = {
  error: (msg, ...args) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, ...args),
  info: (msg, ...args) => CONFIG.LOG_LEVEL !== 'error' && console.log(`[INFO] ${new Date().toISOString()} ${msg}`, ...args),
  debug: (msg, ...args) => CONFIG.LOG_LEVEL === 'debug' && console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`, ...args)
};

// Простое шифрование/дешифрование
class SimpleEncryption {
  static encrypt(data, key) {
    const iv = crypto.randomBytes(12); // 12 байт для GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    // Формат: [iv (12 bytes)][authTag (16 bytes)][encrypted data]
    return Buffer.concat([iv, authTag, encrypted]);
  }

  static decrypt(encryptedData, key) {
    try {
      // Проверяем минимальный размер
      if (encryptedData.length < 28) { // 12 + 16 = 28 байт минимум
        throw new Error('Data too short');
      }

      const iv = encryptedData.slice(0, 12);
      const authTag = encryptedData.slice(12, 28);
      const data = encryptedData.slice(28);
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      
      return Buffer.concat([
        decipher.update(data),
        decipher.final()
      ]);
    } catch (error) {
      logger.debug(`Decryption error: ${error.message}, data length: ${encryptedData?.length || 0}`);
      throw new Error('Decryption failed: ' + error.message);
    }
  }
}

// Простой протокол handshake
const HANDSHAKE_MAGIC = Buffer.from('VPN_HANDSHAKE_1.0');
const HANDSHAKE_RESPONSE = Buffer.from('VPN_WELCOME_1.0');

// VPN сервер TCP
class VPNServerTCP {
  constructor() {
    this.server = net.createServer(this.handleConnection.bind(this));
    this.clientStates = new Map();
  }

  start() {
    this.server.listen(CONFIG.VPN_PORT, '0.0.0.0', () => {
      logger.info(`VPN TCP сервер запущен на порту ${CONFIG.VPN_PORT} (${CONFIG.REGION})`);
      logger.info(`Server key (first 8 bytes): ${SERVER_KEY.slice(0, 8).toString('hex')}`);
    });

    this.server.on('error', (err) => {
      logger.error('Ошибка VPN сервера:', err.message);
    });
  }

  handleConnection(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info(`Новое подключение от ${clientId}`);
    
    // Состояние клиента
    const clientState = {
      handshakeComplete: false,
      buffer: Buffer.alloc(0)
    };
    this.clientStates.set(clientId, clientState);
    
    // Устанавливаем таймаут для handshake
    const handshakeTimeout = setTimeout(() => {
      if (!clientState.handshakeComplete) {
        logger.warn(`Handshake timeout для ${clientId}`);
        socket.destroy();
      }
    }, 10000);

    socket.on('data', async (data) => {
      try {
        clientState.buffer = Buffer.concat([clientState.buffer, data]);
        
        // Если handshake еще не завершен, обрабатываем его
        if (!clientState.handshakeComplete) {
          await this.handleHandshake(clientId, socket, clientState);
        } else {
          // Обрабатываем обычные данные
          await this.handleClientData(clientId, socket, clientState.buffer);
          clientState.buffer = Buffer.alloc(0); // Очищаем буфер после обработки
        }
      } catch (error) {
        logger.warn(`Ошибка обработки данных от ${clientId}: ${error.message}`);
        socket.destroy();
      }
    });

    socket.on('error', (err) => {
      logger.warn(`Ошибка сокета ${clientId}: ${err.message}`);
    });

    socket.on('close', () => {
      clearTimeout(handshakeTimeout);
      this.clientStates.delete(clientId);
      logger.info(`Отключение: ${clientId}`);
    });
  }

  async handleHandshake(clientId, socket, clientState) {
    // Ждем достаточное количество данных для handshake
    if (clientState.buffer.length < HANDSHAKE_MAGIC.length) {
      return; // Ждем еще данных
    }

    try {
      // Проверяем magic bytes
      const receivedMagic = clientState.buffer.slice(0, HANDSHAKE_MAGIC.length);
      
      if (!receivedMagic.equals(HANDSHAKE_MAGIC)) {
        logger.warn(`Invalid handshake magic от ${clientId}`);
        socket.destroy();
        return;
      }

      logger.info(`Handshake от ${clientId} успешен`);
      
      // Отправляем ответный handshake
      const encryptedResponse = SimpleEncryption.rypt(HANDSHAKE_RESPONSE, SERVER_KEY);
      socket.write(encryptedResponse);
      
      clientState.handshakeComplete = true;
      
      // Удаляем handshake данные из буфера
      clientState.buffer = clientState.buffer.slice(HANDSHAKE_MAGIC.length);
      
      logger.info(`Handshake завершен для ${clientId}`);
    } catch (error) {
      logger.error(`Handshake ошибка для ${clientId}: ${error.message}`);
      socket.destroy();
    }
  }

  async handleClientData(clientId, socket, data) {
    try {
      // Дешифруем данные от клиента
      const decrypted = SimpleEncryption.decrypt(data, CLIENT_KEY);
      
      logger.debug(`Данные от ${clientId}: ${decrypted.length} байт`);
      
      // Простая обработка: эхо-ответ
      const response = Buffer.from(`Echo: ${decrypted.toString()}`);
      const encryptedResponse = SimpleEncryption.encrypt(response, SERVER_KEY);
      
      socket.write(encryptedResponse);
      
      // Обновляем статистику
      this.updateStats(clientId, decrypted.length);
    } catch (error) {
      logger.warn(`Ошибка обработки данных от ${clientId}: ${error.message}`);
      throw error;
    }
  }

  updateStats(clientId, bytes) {
    // Здесь можно обновлять статистику по клиентам
  }
}

// Web сервер для health checks
class AdminServer {
  constructor() {
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      bytesTransferred: 0,
      startTime: new Date()
    };
  }

  start() {
    const server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Content-Type', 'application/json');

      if (req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({
          status: 'healthy',
          region: CONFIG.REGION,
          protocol: CONFIG.VPN_PROTOCOL,
          uptime: process.uptime(),
          timestamp: new Date().toISOString()
        }));
      } else if (req.url === '/stats') {
        res.writeHead(200);
        res.end(JSON.stringify({
          region: CONFIG.REGION,
          protocol: CONFIG.VPN_PROTOCOL,
          vpn_port: CONFIG.VPN_PORT,
          server_time: new Date().toISOString(),
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage()
        }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({
          name: 'VPN Server',
          region: CONFIG.REGION,
          endpoints: ['/health', '/stats'],
          documentation: 'VPN сервер для региона Oregon (US West)'
        }));
      }
    });

    server.listen(CONFIG.ADMIN_PORT, '0.0.0.0', () => {
      logger.info(`Admin сервер запущен на порту ${CONFIG.ADMIN_PORT}`);
    });

    return server;
  }
}

// Тестовый клиент для проверки сервера
class TestClient {
  static async testConnection(port = CONFIG.VPN_PORT, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(port, host, () => {
        logger.info(`Test client подключен к ${host}:${port}`);
        
        // Отправляем handshake
        socket.write(HANDSHAKE_MAGIC);
        
        // Ожидаем ответ
        socket.once('data', (data) => {
          try {
            const decrypted = SimpleEncryption.decrypt(data, SERVER_KEY);
            
            if (decrypted.equals(HANDSHAKE_RESPONSE)) {
              logger.info('Handshake успешен!');
              
              // Отправляем тестовые данные
              const testData = Buffer.from('Test message from client');
              const encryptedTest = SimpleEncryption.encrypt(testData, CLIENT_KEY);
              socket.write(encryptedTest);
              
              // Ожидаем ответ
              socket.once('data', (responseData) => {
                try {
                  const decryptedResponse = SimpleEncryption.decrypt(responseData, SERVER_KEY);
                  logger.info(`Получен ответ: ${decryptedResponse.toString()}`);
                  socket.end();
                  resolve(true);
                } catch (error) {
                  socket.destroy();
                  reject(new Error(`Ошибка дешифрования ответа: ${error.message}`));
                }
              });
            } else {
              socket.destroy();
              reject(new Error('Invalid handshake response'));
            }
          } catch (error) {
            socket.destroy();
            reject(new Error(`Ошибка handshake: ${error.message}`));
          }
        });
      });
      
      socket.on('error', (err) => {
        reject(new Error(`Socket error: ${err.message}`));
      });
      
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }
}

// Основная функция запуска
async function startServer() {
  logger.info(`Запуск VPN сервера в регионе: ${CONFIG.REGION}`);
  logger.info(`Протокол: ${CONFIG.VPN_PROTOCOL}`);
  logger.info(`Порт VPN: ${CONFIG.VPN_PORT}`);
  logger.info(`Порт админки: ${CONFIG.ADMIN_PORT}`);
  
  // Запуск VPN сервера
  const vpnServer = new VPNServerTCP();
  vpnServer.start();
  
  // Запуск админ сервера
  const adminServer = new AdminServer();
  adminServer.start();
  
  // Если запущено локально, тестируем соединение
  if (process.env.NODE_ENV !== 'production' && CONFIG.VPN_PORT === '1194') {
    setTimeout(async () => {
      try {
        logger.info('Запуск тестового клиента...');
        await TestClient.testConnection();
        logger.info('Тест соединения успешен!');
      } catch (error) {
        logger.error(`Тест соединения не удался: ${error.message}`);
      }
    }, 1000);
  }
  
  // Graceful shutdown
  const gracefulShutdown = () => {
    logger.info('Завершение работы сервера...');
    process.exit(0);
  };
  
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

// Запуск сервера
if (require.main === module) {
  startServer().catch(error => {
    logger.error('Ошибка запуска сервера:', error);
    process.exit(1);
  });
}

module.exports = {
  startServer,
  TestClient,
  SimpleEncryption,
  CONFIG
};
