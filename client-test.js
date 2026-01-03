// client-test.js - простой клиент для тестирования
const net = require('net');
const crypto = require('crypto');

// Ключи должны совпадать с сервером
const SECRET_KEY = process.env.VPN_SECRET || 'demo-secret-key-for-vpn-oregon-123';
const SERVER_KEY = crypto.createHash('sha256').update(SECRET_KEY + '-server').digest();
const CLIENT_KEY = crypto.createHash('sha256').update(SECRET_KEY + '-client').digest();

class SimpleEncryption {
  static encrypt(data, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  }

  static decrypt(encryptedData, key) {
    try {
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
      throw new Error('Decryption failed: ' + error.message);
    }
  }
}

// Константы протокола
const HANDSHAKE_MAGIC = Buffer.from('VPN_HANDSHAKE_1.0');
const HANDSHAKE_RESPONSE = Buffer.from('VPN_WELCOME_1.0');

class VPNClient {
  constructor(host = '127.0.0.1', port = 1194) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.port, this.host, () => {
        console.log(`Подключено к ${this.host}:${this.port}`);
        
        // Отправляем handshake
        this.socket.write(HANDSHAKE_MAGIC);
        
        // Ожидаем ответный handshake
        this.socket.once('data', (data) => {
          try {
            const decrypted = SimpleEncryption.decrypt(data, SERVER_KEY);
            
            if (decrypted.equals(HANDSHAKE_RESPONSE)) {
              console.log('Handshake успешен!');
              this.connected = true;
              resolve();
            } else {
              reject(new Error('Invalid handshake response from server'));
            }
          } catch (error) {
            reject(new Error(`Handshake failed: ${error.message}`));
          }
        });
      });
      
      this.socket.on('error', (err) => {
        reject(new Error(`Connection error: ${err.message}`));
      });
      
      this.socket.setTimeout(10000, () => {
        this.socket.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }

  async send(data) {
    if (!this.connected || !this.socket) {
      throw new Error('Not connected');
    }
    
    return new Promise((resolve, reject) => {
      const encryptedData = SimpleEncryption.encrypt(Buffer.from(data), CLIENT_KEY);
      
      this.socket.write(encryptedData);
      
      this.socket.once('data', (response) => {
        try {
          const decrypted = SimpleEncryption.decrypt(response, SERVER_KEY);
          resolve(decrypted.toString());
        } catch (error) {
          reject(new Error(`Failed to decrypt response: ${error.message}`));
        }
      });
      
      this.socket.once('error', (err) => {
        reject(new Error(`Send error: ${err.message}`));
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
      this.connected = false;
      console.log('Отключено от сервера');
    }
  }
}

// Пример использования
async function test() {
  const client = new VPNClient();
  
  try {
    // Подключаемся к серверу
    await client.connect();
    console.log('Успешно подключено!');
    
    // Отправляем тестовое сообщение
    const response = await client.send('Hello VPN Server from Oregon!');
    console.log('Ответ от сервера:', response);
    
    // Отправляем еще одно сообщение
    const response2 = await client.send('Test message 2');
    console.log('Второй ответ:', response2);
    
  } catch (error) {
    console.error('Ошибка:', error.message);
  } finally {
    // Отключаемся
    client.disconnect();
  }
}

// Запуск теста
if (require.main === module) {
  test();
}

module.exports = VPNClient;
