// test-client.js
const net = require('net');
const crypto = require('crypto');

const SECRET_KEY = 'vpn-oregon-secret-key-2024';
const SHARED_KEY = crypto.createHash('sha256').update(SECRET_KEY).digest();

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
    } catch (err) {
      console.error('Ошибка дешифрования:', err.message);
      return null;
    }
  }
}

class VPNClient {
  constructor(host = '127.0.0.1', port = 1194) {
    this.host = host;
    this.port = port;
    this.socket = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.port, this.host, () => {
        console.log(`✅ Подключено к ${this.host}:${this.port}`);
        
        // Получаем приветственное сообщение
        this.socket.once('data', (welcomeData) => {
          const welcome = SimpleCipher.decrypt(welcomeData);
          if (welcome) {
            console.log('📨 Сервер говорит:', welcome.toString().trim());
          }
          resolve();
        });
      });
      
      this.socket.on('error', reject);
      this.socket.setTimeout(5000, () => {
        reject(new Error('Таймаут подключения'));
      });
    });
  }

  send(message) {
    return new Promise((resolve, reject) => {
      const encrypted = SimpleCipher.encrypt(Buffer.from(message));
      this.socket.write(encrypted);
      
      this.socket.once('data', (responseData) => {
        const response = SimpleCipher.decrypt(responseData);
        if (response) {
          resolve(response.toString());
        } else {
          reject(new Error('Не удалось расшифровать ответ'));
        }
      });
      
      this.socket.once('error', reject);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.end();
      console.log('🔌 Отключено от сервера');
    }
  }
}

// Использование
async function main() {
  const client = new VPNClient();
  
  try {
    // Подключаемся
    await client.connect();
    
    // Отправляем несколько сообщений
    const messages = [
      'Привет из Орегона!',
      'Как работает VPN?',
      'Тестирование связи',
      'exit' // Это закроет соединение
    ];
    
    for (const msg of messages) {
      console.log(`📤 Отправляю: "${msg}"`);
      const response = await client.send(msg);
      console.log(`📨 Ответ: ${response.trim()}`);
      
      // Небольшая пауза между сообщениями
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (msg.toLowerCase() === 'exit') break;
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  } finally {
    client.disconnect();
  }
}

// Запуск
if (require.main === module) {
  main();
}
