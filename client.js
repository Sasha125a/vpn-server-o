// client.js - VPN клиент для терминала
const net = require('net');
const readline = require('readline');

class VPNClient {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      console.log(`🔗 Подключение к ${this.host}:${this.port}...`);
      
      this.socket = net.createConnection({
        host: this.host,
        port: this.port,
        timeout: 30000 // Увеличиваем таймаут
      }, () => {
        console.log('✅ Успешно подключено!');
        this.connected = true;
        resolve();
      });
      
      this.socket.on('data', (data) => {
        process.stdout.write(data.toString());
      });
      
      this.socket.on('error', (err) => {
        if (!this.connected) {
          console.error(`❌ Ошибка подключения: ${err.message}`);
          console.log('\n🔧 Возможные решения:');
          console.log('1. Проверьте, что сервер запущен на Render');
          console.log('2. Убедитесь в правильности адреса:');
          console.log(`   Ваш сервер должен быть: ваш-проект.onrender.com`);
          console.log('3. Попробуйте создать свой сервер:');
          console.log('   - Зайдите на render.com');
          console.log('   - Создайте Web Service');
          console.log('   - Выберите регион Oregon');
          console.log('   - Загрузите этот код\n');
          reject(err);
        }
      });
      
      this.socket.on('close', () => {
        if (this.connected) {
          console.log('\n🔌 Соединение закрыто');
          process.exit(0);
        }
      });
      
      this.socket.on('timeout', () => {
        console.error('⏰ Таймаут соединения');
        console.log('ℹ️  Сервер не отвечает. Возможно:');
        console.log('   - Сервер не запущен на Render');
        console.log('   - Неправильное имя сервера');
        console.log('   - Render завершил бесплатный инстанс');
        this.socket.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  startInteractive() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'VPN> '
    });
    
    rl.prompt();
    
    rl.on('line', (line) => {
      if (this.connected) {
        this.socket.write(line + '\n');
        
        if (line.trim().toUpperCase() === 'EXIT') {
          setTimeout(() => {
            this.socket.end();
            rl.close();
          }, 1000);
        }
      }
      rl.prompt();
    });
    
    rl.on('close', () => {
      console.log('👋 До свидания!');
      if (this.socket) this.socket.end();
      process.exit(0);
    });
  }
}

// Если запущен напрямую
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
    🔧 VPN Client for Render
    
    Использование:
      node client.js <ваш-сервер>.onrender.com <порт>
    
    Пример:
      node client.js vpn-oregon.onrender.com 3000
    
    Если у вас нет сервера:
    1. Создайте аккаунт на render.com
    2. Создайте Web Service с этим кодом
    3. Выберите регион Oregon (US West)
    4. Получите ваш адрес: ваш-проект.onrender.com
    5. Запустите клиент с вашим адресом
    
    Команды в VPN:
      PING    - Проверить соединение
      STATS   - Статистика сервера
      EXIT    - Выйти
      любой текст - Отправить эхо
    `);
    process.exit(1);
  }
  
  const host = args[0];
  const port = parseInt(args[1]) || 3000;
  
  const client = new VPNClient(host, port);
  
  client.connect()
    .then(() => {
      console.log('\n📡 VPN подключен! Доступные команды:');
      console.log('  PING    - Проверить соединение');
      console.log('  STATS   - Статистика сервера');
      console.log('  EXIT    - Выйти');
      console.log('  Любой текст - Отправить сообщение\n');
      client.startInteractive();
    })
    .catch(() => {
      console.log('\n🎯 Попробуйте создать свой сервер:');
      console.log('1. Скопируйте этот код в папку:');
      console.log('   server.js');
      console.log('   package.json');
      console.log('   client.js');
      console.log('\n2. Создайте package.json:');
      console.log(`   {
  "name": "vpn-oregon",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=14.0.0"
  }
}`);
      console.log('\n3. Загрузите на GitHub');
      console.log('4. Создайте Web Service на render.com');
      console.log('5. Выберите регион Oregon');
      console.log('6. Получите ваш адрес: ваш-проект.onrender.com');
      console.log('7. Запустите: node client.js ваш-проект.onrender.com\n');
    });
}

module.exports = VPNClient;
