// server.js
const net = require('net');
const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Конфигурация сервера
const CONFIG = {
  PORT: process.env.PORT || 3000,
  VPN_PORT: process.env.VPN_PORT || 1194,
  ADMIN_PORT: process.env.ADMIN_PORT || 3001,
  VPN_PROTOCOL: process.env.VPN_PROTOCOL || 'tcp', // или 'udp'
  REGION: 'Oregon (US West)',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// Хранилище клиентов
const clients = new Map();
const clientStats = new Map();

// Генерация ключей (в production используйте безопасное хранение)
const generateKeys = () => {
  const secret = process.env.VPN_SECRET || crypto.randomBytes(32).toString('hex');
  return {
    serverKey: crypto.createHash('sha256').update(`server-${secret}`).digest(),
    clientKey: crypto.createHash('sha256').update(`client-${secret}`).digest()
  };
};

const KEYS = generateKeys();

// Логирование
const logger = {
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
  info: (msg, ...args) => CONFIG.LOG_LEVEL === 'info' && console.log(`[INFO] ${msg}`, ...args),
  debug: (msg, ...args) => CONFIG.LOG_LEVEL === 'debug' && console.log(`[DEBUG] ${msg}`, ...args)
};

// Шифрование/дешифрование
const encrypt = (data, key) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
};

const decrypt = (data, key) => {
  try {
    const iv = data.slice(0, 16);
    const authTag = data.slice(16, 32);
    const encrypted = data.slice(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (error) {
    throw new Error('Decryption failed');
  }
};

// VPN сервер TCP
class VPNServerTCP {
  constructor() {
    this.server = net.createServer(this.handleConnection.bind(this));
  }

  start() {
    this.server.listen(CONFIG.VPN_PORT, '0.0.0.0', () => {
      logger.info(`VPN TCP сервер запущен на порту ${CONFIG.VPN_PORT} (${CONFIG.REGION})`);
    });

    this.server.on('error', (err) => {
      logger.error('Ошибка VPN сервера:', err.message);
    });
  }

  handleConnection(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info(`Новое подключение: ${clientId}`);

    socket.on('data', (data) => {
      try {
        const decrypted = decrypt(data, KEYS.clientKey);
        this.handleVPNData(clientId, decrypted);
      } catch (error) {
        logger.warn(`Ошибка дешифрования от ${clientId}: ${error.message}`);
      }
    });

    socket.on('error', (err) => {
      logger.warn(`Ошибка сокета ${clientId}: ${err.message}`);
    });

    socket.on('close', () => {
      logger.info(`Отключение: ${clientId}`);
      clients.delete(clientId);
    });

    // Отправка ключа сервера клиенту
    const handshake = Buffer.from('VPN_SERVER_HANDSHAKE');
    socket.write(encrypt(handshake, KEYS.serverKey));
  }

  handleVPNData(clientId, data) {
    // Здесь должна быть логика маршрутизации VPN трафика
    logger.debug(`Данные от ${clientId}: ${data.length} байт`);
    
    // Пример: эхо-ответ
    const client = clients.get(clientId);
    if (client && !client.destroyed) {
      client.write(encrypt(data, KEYS.serverKey));
    }
  }
}

// VPN сервер UDP
class VPNServerUDP {
  constructor() {
    this.server = dgram.createSocket('udp4');
    this.clientAddresses = new Map();
  }

  start() {
    this.server.bind(CONFIG.VPN_PORT, '0.0.0.0', () => {
      logger.info(`VPN UDP сервер запущен на порту ${CONFIG.VPN_PORT} (${CONFIG.REGION})`);
    });

    this.server.on('message', this.handleMessage.bind(this));
    this.server.on('error', (err) => {
      logger.error('Ошибка UDP сервера:', err.message);
    });
  }

  handleMessage(msg, rinfo) {
    const clientId = `${rinfo.address}:${rinfo.port}`;
    
    try {
      const decrypted = decrypt(msg, KEYS.clientKey);
      this.clientAddresses.set(clientId, rinfo);
      this.handleVPNData(clientId, decrypted);
    } catch (error) {
      logger.warn(`Ошибка дешифрования от ${clientId}: ${error.message}`);
    }
  }

  handleVPNData(clientId, data) {
    logger.debug(`UDP данные от ${clientId}: ${data.length} байт`);
    
    // Пример: эхо-ответ
    const rinfo = this.clientAddresses.get(clientId);
    if (rinfo) {
      const response = encrypt(data, KEYS.serverKey);
      this.server.send(response, rinfo.port, rinfo.address);
    }
  }
}

// Web сервер для административного интерфейса и health checks
const http = require('http');
const url = require('url');

class AdminServer {
  constructor() {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  start() {
    this.server.listen(CONFIG.ADMIN_PORT, '0.0.0.0', () => {
      logger.info(`Admin сервер запущен на порту ${CONFIG.ADMIN_PORT}`);
    });
  }

  handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    // Health check для Render
    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'healthy',
        region: CONFIG.REGION,
        protocol: CONFIG.VPN_PROTOCOL,
        clients: clients.size,
        timestamp: new Date().toISOString()
      }));
    }

    // Статистика
    if (parsedUrl.pathname === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        region: CONFIG.REGION,
        protocol: CONFIG.VPN_PROTOCOL,
        active_clients: clients.size,
        server_time: new Date().toISOString(),
        vpn_port: CONFIG.VPN_PORT,
        admin_port: CONFIG.ADMIN_PORT
      }));
    }

    // Главная страница
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>VPN Сервер ${CONFIG.REGION}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
                .container { max-width: 800px; margin: 0 auto; }
                .status { padding: 20px; background: #f4f4f4; border-radius: 5px; }
                .healthy { color: green; }
                .info { margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 VPN Сервер ${CONFIG.REGION}</h1>
                <div class="status">
                    <p><strong>Статус:</strong> <span class="healthy">● Активен</span></p>
                    <p><strong>Протокол:</strong> ${CONFIG.VPN_PROTOCOL.toUpperCase()}</p>
                    <p><strong>Порт VPN:</strong> ${CONFIG.VPN_PORT}</p>
                    <p><strong>Клиентов:</strong> ${clients.size}</p>
                    <p><strong>Регион:</strong> ${CONFIG.REGION}</p>
                </div>
                <div class="info">
                    <h3>Информация:</h3>
                    <p>Сервер работает на Render в регионе Oregon (US West).</p>
                    <p>Для подключения используйте VPN клиент с настройками:</p>
                    <ul>
                        <li>Адрес: <code>ваш-сервер.onrender.com</code></li>
                        <li>Порт: ${CONFIG.VPN_PORT}</li>
                        <li>Протокол: ${CONFIG.VPN_PROTOCOL}</li>
                    </ul>
                    <p><a href="/stats">Детальная статистика</a> | <a href="/health">Health Check</a></p>
                </div>
            </div>
        </body>
        </html>
      `);
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
}

// Основная функция запуска
async function startServer() {
  logger.info(`Запуск VPN сервера в регионе: ${CONFIG.REGION}`);
  logger.info(`Протокол: ${CONFIG.VPN_PROTOCOL}`);
  logger.info(`Порт VPN: ${CONFIG.VPN_PORT}`);
  logger.info(`Порт админки: ${CONFIG.ADMIN_PORT}`);
  
  // Запуск VPN сервера в зависимости от выбранного протокола
  if (CONFIG.VPN_PROTOCOL.toLowerCase() === 'udp') {
    const udpServer = new VPNServerUDP();
    udpServer.start();
  } else {
    const tcpServer = new VPNServerTCP();
    tcpServer.start();
  }
  
  // Запуск админ сервера
  const adminServer = new AdminServer();
  adminServer.start();
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Получен SIGTERM. Завершение работы...');
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    logger.info('Получен SIGINT. Завершение работы...');
    process.exit(0);
  });
  
  // Обработка необработанных исключений
  process.on('uncaughtException', (error) => {
    logger.error('Необработанное исключение:', error);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Необработанный промис:', reason);
  });
}

// Запуск сервера, если файл запущен напрямую
if (require.main === module) {
  startServer().catch(error => {
    logger.error('Ошибка запуска сервера:', error);
    process.exit(1);
  });
}

module.exports = { startServer, CONFIG, logger };
