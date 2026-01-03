// server.js - VPN сервер для Render (Oregon)
const net = require('net');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Конфигурация
const CONFIG = {
  VPN_PORT: process.env.PORT || 3000, // Render использует PORT
  ADMIN_PORT: 3001,
  REGION: 'Oregon (US West)',
  SECRET_KEY: process.env.VPN_SECRET || crypto.randomBytes(32).toString('hex'),
  HOSTNAME: process.env.RENDER_EXTERNAL_HOSTNAME || 'vpn-server-o.onrender.com'
};

// Логирование
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  debug: (msg) => process.env.DEBUG && console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`)
};

// Простой протокол VPN
class VPNProtocol {
  static MAGIC_HEADER = Buffer.from('RENDER_VPN_1.0');
  
  static createPacket(type, data) {
    const typeBuffer = Buffer.from([type]);
    const lengthBuffer = Buffer.alloc(2);
    lengthBuffer.writeUInt16BE(data.length);
    return Buffer.concat([this.MAGIC_HEADER, typeBuffer, lengthBuffer, data]);
  }
  
  static parsePacket(buffer) {
    if (buffer.length < this.MAGIC_HEADER.length + 3) return null;
    if (!buffer.slice(0, this.MAGIC_HEADER.length).equals(this.MAGIC_HEADER)) return null;
    
    const type = buffer[this.MAGIC_HEADER.length];
    const length = buffer.readUInt16BE(this.MAGIC_HEADER.length + 1);
    const dataStart = this.MAGIC_HEADER.length + 3;
    
    if (buffer.length < dataStart + length) return null;
    
    return {
      type,
      data: buffer.slice(dataStart, dataStart + length),
      totalLength: dataStart + length
    };
  }
}

// Шифрование
class VPNSecurity {
  constructor(key) {
    this.key = crypto.createHash('sha256').update(key).digest();
    this.iv = crypto.randomBytes(16);
  }
  
  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.key, iv);
    
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return Buffer.concat([iv, encrypted]);
  }
  
  decrypt(data) {
    try {
      const iv = data.slice(0, 16);
      const encrypted = data.slice(16);
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.key, iv);
      
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted;
    } catch (error) {
      return null;
    }
  }
}

// VPN сервер
class VPNServer {
  constructor() {
    this.clients = new Map();
    this.security = new VPNSecurity(CONFIG.SECRET_KEY);
    this.server = net.createServer(this.handleConnection.bind(this));
    
    // Маршруты для туннелирования
    this.routes = new Map();
  }
  
  start() {
    this.server.listen(CONFIG.VPN_PORT, '0.0.0.0', () => {
      logger.info(`🚀 VPN сервер запущен на ${CONFIG.HOSTNAME}:${CONFIG.VPN_PORT}`);
      logger.info(`📍 Регион: ${CONFIG.REGION}`);
      logger.info(`🔑 Ключ: ${CONFIG.SECRET_KEY.substring(0, 8)}...`);
    });
    
    this.server.on('error', (err) => {
      logger.error(`Ошибка сервера: ${err.message}`);
    });
  }
  
  handleConnection(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info(`🔌 Новый клиент: ${clientId}`);
    
    const client = {
      id: clientId,
      socket: socket,
      connectedAt: new Date(),
      buffer: Buffer.alloc(0),
      authenticated: false
    };
    
    this.clients.set(clientId, client);
    
    // Отправляем приветствие
    this.sendWelcome(client);
    
    socket.on('data', (data) => {
      this.handleClientData(client, data);
    });
    
    socket.on('error', (err) => {
      logger.error(`Ошибка клиента ${clientId}: ${err.message}`);
    });
    
    socket.on('close', () => {
      logger.info(`🔌 Отключен: ${clientId}`);
      this.clients.delete(clientId);
    });
    
    socket.on('end', () => {
      logger.debug(`Клиент ${clientId} завершил соединение`);
    });
  }
  
  sendWelcome(client) {
    const welcomeData = JSON.stringify({
      type: 'welcome',
      server: CONFIG.HOSTNAME,
      region: CONFIG.REGION,
      timestamp: new Date().toISOString(),
      protocol: 'RENDER_VPN_1.0'
    });
    
    const packet = VPNProtocol.createPacket(0x01, Buffer.from(welcomeData));
    const encrypted = this.security.encrypt(packet);
    
    client.socket.write(encrypted);
  }
  
  handleClientData(client, data) {
    // Добавляем данные в буфер
    client.buffer = Buffer.concat([client.buffer, data]);
    
    // Пробуем расшифровать
    const decrypted = this.security.decrypt(client.buffer);
    
    if (decrypted) {
      const packet = VPNProtocol.parsePacket(decrypted);
      
      if (packet) {
        this.processPacket(client, packet);
        client.buffer = client.buffer.slice(packet.totalLength);
      }
    }
  }
  
  processPacket(client, packet) {
    try {
      switch(packet.type) {
        case 0x02: // Аутентификация
          this.handleAuth(client, packet.data);
          break;
          
        case 0x03: // Данные
          this.handleData(client, packet.data);
          break;
          
        case 0x04: // PING
          this.handlePing(client);
          break;
          
        default:
          logger.debug(`Неизвестный тип пакета: 0x${packet.type.toString(16)}`);
      }
    } catch (error) {
      logger.error(`Ошибка обработки пакета: ${error.message}`);
    }
  }
  
  handleAuth(client, data) {
    const auth = JSON.parse(data.toString());
    
    if (auth.token === CONFIG.SECRET_KEY || auth.password === 'vpn123') {
      client.authenticated = true;
      
      const response = JSON.stringify({
        status: 'authenticated',
        clientId: client.id,
        serverInfo: {
          hostname: CONFIG.HOSTNAME,
          region: CONFIG.REGION
        }
      });
      
      const packet = VPNProtocol.createPacket(0x02, Buffer.from(response));
      const encrypted = this.security.encrypt(packet);
      
      client.socket.write(encrypted);
      logger.info(`✅ Аутентифицирован: ${client.id}`);
    } else {
      logger.warn(`❌ Неудачная аутентификация: ${client.id}`);
      client.socket.end();
    }
  }
  
  handleData(client, data) {
    if (!client.authenticated) {
      logger.warn(`Клиент ${client.id} не аутентифицирован`);
      return;
    }
    
    const message = data.toString();
    logger.debug(`📨 Данные от ${client.id}: ${message.substring(0, 50)}...`);
    
    // Эхо-ответ
    const response = JSON.stringify({
      type: 'echo',
      message: message,
      timestamp: new Date().toISOString(),
      server: CONFIG.HOSTNAME
    });
    
    const packet = VPNProtocol.createPacket(0x03, Buffer.from(response));
    const encrypted = this.security.encrypt(packet);
    
    client.socket.write(encrypted);
  }
  
  handlePing(client) {
    const response = JSON.stringify({
      type: 'pong',
      timestamp: new Date().toISOString(),
      serverTime: Date.now()
    });
    
    const packet = VPNProtocol.createPacket(0x04, Buffer.from(response));
    const encrypted = this.security.encrypt(packet);
    
    client.socket.write(encrypted);
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
      logger.info(`🌐 Web интерфейс: http://0.0.0.0:${CONFIG.ADMIN_PORT}`);
    });
  }
  
  handleRequest(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }
    
    if (req.url === '/health') {
      res.writeHead(200);
      return res.end(JSON.stringify({
        status: 'healthy',
        service: 'vpn-server',
        region: CONFIG.REGION,
        hostname: CONFIG.HOSTNAME,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }, null, 2));
    }
    
    if (req.url === '/stats') {
      const stats = {
        server: {
          region: CONFIG.REGION,
          hostname: CONFIG.HOSTNAME,
          port: CONFIG.VPN_PORT,
          uptime: process.uptime(),
          memory: process.memoryUsage()
        },
        clients: {
          active: this.vpnServer.clients.size,
          total: Array.from(this.vpnServer.clients.values()).map(c => ({
            id: c.id,
            connectedAt: c.connectedAt,
            authenticated: c.authenticated
          }))
        }
      };
      
      res.writeHead(200);
      return res.end(JSON.stringify(stats, null, 2));
    }
    
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>VPN Server ${CONFIG.REGION}</title>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
            .status { background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .info { margin: 20px 0; }
            code { background: #f1f1f1; padding: 2px 5px; border-radius: 3px; }
            .endpoints { background: #e3f2fd; padding: 15px; border-radius: 5px; }
            a { color: #2196F3; text-decoration: none; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚀 VPN Server ${CONFIG.REGION}</h1>
            <div class="status">
              <strong>Статус:</strong> <span style="color: #4CAF50;">● Активен</span><br>
              <strong>Хост:</strong> ${CONFIG.HOSTNAME}<br>
              <strong>Порт VPN:</strong> ${CONFIG.VPN_PORT}<br>
              <strong>Клиентов:</strong> ${this.vpnServer.clients.size}
            </div>
            <div class="info">
              <h3>Подключение:</h3>
              <p>Используйте клиент для подключения:</p>
              <code>node client.js ${CONFIG.HOSTNAME} ${CONFIG.VPN_PORT}</code>
            </div>
            <div class="endpoints">
              <h3>API Endpoints:</h3>
              <ul>
                <li><a href="/health">/health</a> - Проверка состояния</li>
                <li><a href="/stats">/stats</a> - Статистика сервера</li>
              </ul>
            </div>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 0.9em;">
              <p>Развернуто на Render в регионе Oregon (US West)</p>
              <p>Для получения клиента проверьте README</p>
            </div>
          </div>
        </body>
        </html>
      `);
    }
    
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
}

// Тестовый клиент в консоли (запускается отдельно)
class VPNClient {
  constructor(host, port) {
    this.host = host || CONFIG.HOSTNAME;
    this.port = port || CONFIG.VPN_PORT;
    this.socket = null;
    this.security = new VPNSecurity(CONFIG.SECRET_KEY);
    this.buffer = Buffer.alloc(0);
  }
  
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.port, this.host, () => {
        console.log(`✅ Подключено к ${this.host}:${this.port}`);
        resolve();
      });
      
      this.socket.on('data', (data) => {
        this.handleData(data);
      });
      
      this.socket.on('error', reject);
      this.socket.setTimeout(10000, () => {
        reject(new Error('Таймаут подключения'));
      });
    });
  }
  
  handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    
    const decrypted = this.security.decrypt(this.buffer);
    
    if (decrypted) {
      const packet = VPNProtocol.parsePacket(decrypted);
      
      if (packet) {
        this.processPacket(packet);
        this.buffer = this.buffer.slice(packet.totalLength);
      }
    }
  }
  
  processPacket(packet) {
    const data = JSON.parse(packet.data.toString());
    
    switch(packet.type) {
      case 0x01: // Приветствие
        console.log(`\n🎉 Приветствие от сервера:`);
        console.log(`   Сервер: ${data.server}`);
        console.log(`   Регион: ${data.region}`);
        console.log(`   Протокол: ${data.protocol}`);
        
        // Автоматическая аутентификация
        this.authenticate();
        break;
        
      case 0x02: // Ответ на аутентификацию
        if (data.status === 'authenticated') {
          console.log(`\n✅ Аутентификация успешна!`);
          console.log(`   Ваш ID: ${data.clientId}`);
          console.log(`\n📡 Теперь вы можете отправлять сообщения:`);
          console.log(`   Введите сообщение и нажмите Enter`);
          console.log(`   Введите 'exit' для выхода`);
          console.log(`   Введите 'stats' для статистики\n`);
          
          this.startInteractiveMode();
        }
        break;
        
      case 0x03: // Данные
        console.log(`\n📨 Ответ сервера:`);
        console.log(`   Сообщение: ${data.message}`);
        console.log(`   Время: ${new Date(data.timestamp).toLocaleTimeString()}`);
        break;
        
      case 0x04: // PONG
        console.log(`🏓 PONG от сервера: ${data.serverTime}`);
        break;
    }
  }
  
  authenticate() {
    const authData = JSON.stringify({
      token: CONFIG.SECRET_KEY,
      client: 'node-vpn-client',
      version: '1.0'
    });
    
    const packet = VPNProtocol.createPacket(0x02, Buffer.from(authData));
    const encrypted = this.security.encrypt(packet);
    
    this.socket.write(encrypted);
  }
  
  sendMessage(message) {
    const data = JSON.stringify({
      message: message,
      timestamp: Date.now(),
      client: 'terminal'
    });
    
    const packet = VPNProtocol.createPacket(0x03, Buffer.from(data));
    const encrypted = this.security.encrypt(packet);
    
    this.socket.write(encrypted);
  }
  
  sendPing() {
    const packet = VPNProtocol.createPacket(0x04, Buffer.from('ping'));
    const encrypted = this.security.encrypt(packet);
    
    this.socket.write(encrypted);
  }
  
  startInteractiveMode() {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'VPN> '
    });
    
    rl.prompt();
    
    rl.on('line', (line) => {
      const input = line.trim();
      
      if (input === 'exit') {
        console.log('👋 Завершение работы...');
        this.socket.end();
        rl.close();
        process.exit(0);
      } else if (input === 'ping') {
        this.sendPing();
      } else if (input === 'stats') {
        console.log(`📊 Статистика подключения`);
        console.log(`   Сервер: ${this.host}:${this.port}`);
        console.log(`   Время: ${new Date().toLocaleString()}`);
      } else if (input) {
        this.sendMessage(input);
      }
      
      rl.prompt();
    });
    
    rl.on('close', () => {
      console.log('👋 До свидания!');
      process.exit(0);
    });
  }
}

// Главная функция сервера
function startServer() {
  logger.info(`🚀 Запуск VPN сервера для Render...`);
  logger.info(`📍 Регион: ${CONFIG.REGION}`);
  logger.info(`🌐 Хост: ${CONFIG.HOSTNAME}`);
  
  const vpnServer = new VPNServer();
  vpnServer.start();
  
  const adminServer = new AdminServer(vpnServer);
  adminServer.start();
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('🛑 Получен SIGTERM, завершение...');
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    logger.info('🛑 Получен SIGINT, завершение...');
    process.exit(0);
  });
}

// Если файл запущен как сервер
if (require.main === module && process.argv[2] !== '--client') {
  startServer();
}

// Экспортируем клиент для использования
module.exports = {
  VPNClient,
  CONFIG,
  startServer
};

// Запуск клиента из командной строки
if (require.main === module && process.argv[2] === '--client') {
  const host = process.argv[3] || CONFIG.HOSTNAME;
  const port = parseInt(process.argv[4]) || CONFIG.VPN_PORT;
  
  console.log(`🔗 Подключение к ${host}:${port}...`);
  
  const client = new VPNClient(host, port);
  
  client.connect().catch(error => {
    console.error(`❌ Ошибка подключения: ${error.message}`);
    console.log(`\nПопробуйте:`);
    console.log(`1. Проверьте, что сервер запущен: https://${host}/health`);
    console.log(`2. Убедитесь, что порт ${port} доступен`);
    console.log(`3. Проверьте интернет-соединение`);
    process.exit(1);
  });
}
