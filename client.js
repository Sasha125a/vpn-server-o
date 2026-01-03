// client.js - VPN клиент для Render сервера
const net = require('net');
const readline = require('readline');

class VPNClient {
  constructor(host = 'vpn-server-o.onrender.com', port = 10000) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      console.clear();
      console.log('╔════════════════════════════════════════╗');
      console.log('║       🚀 VPN CLIENT FOR RENDER        ║');
      console.log('╚════════════════════════════════════════╝\n');
      
      console.log(`🔗 Подключение к ${this.host}:${this.port}...`);
      console.log('⏳ Пожалуйста, подождите...\n');
      
      this.socket = net.createConnection({
        host: this.host,
        port: this.port,
        timeout: 15000
      }, () => {
        console.log('✅ Успешно подключено к VPN серверу!');
        console.log('📍 Регион: Oregon (US West)');
        console.log('\n════════════════════════════════════════');
        this.connected = true;
        resolve();
      });
      
      // Обработка данных от сервера
      this.socket.on('data', (data) => {
        process.stdout.write(data.toString());
      });
      
      this.socket.on('error', (err) => {
        if (!this.connected) {
          console.error(`\n❌ Ошибка подключения: ${err.message}`);
          
          if (err.code === 'ECONNREFUSED') {
            console.log('\n🔧 Возможные причины:');
            console.log('1. Сервер не запущен или перезагружается');
            console.log('2. Неправильный порт');
            console.log('3. Render завершил инстанс (бесплатный план)');
            console.log('\n💡 Решения:');
            console.log('• Откройте в браузере: https://' + this.host);
            console.log('• Подождите 30-60 секунд для запуска сервера');
            console.log('• Проверьте логи на Render Dashboard');
          } else if (err.code === 'ETIMEDOUT') {
            console.log('\n⏰ Таймаут подключения');
            console.log('• Проверьте интернет соединение');
            console.log('• Возможно, сервер выключен');
          }
          
          reject(err);
        }
      });
      
      this.socket.on('close', () => {
        if (this.connected) {
          console.log('\n🔌 Соединение закрыто сервером');
          process.exit(0);
        }
      });
      
      this.socket.on('timeout', () => {
        console.error('\n⏰ Таймаут соединения');
        console.log('Попробуйте:');
        console.log('1. Проверить что сервер запущен: https://' + this.host);
        console.log('2. Подождать 1-2 минуты (бесплатный инстанс просыпается)');
        this.socket.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }

  startInteractive() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    // Простой промпт
    process.stdout.write('\nVPN> ');
    
    rl.on('line', (line) => {
      if (this.connected) {
        this.socket.write(line + '\n');
        
        if (line.trim().toUpperCase() === 'EXIT') {
          setTimeout(() => {
            console.log('\n👋 Завершение работы...');
            this.socket.end();
            rl.close();
            process.exit(0);
          }, 500);
        } else {
          // Показываем промпт снова через небольшой таймаут
          setTimeout(() => process.stdout.write('VPN> '), 100);
        }
      }
    });
    
    rl.on('close', () => {
      console.log('\n👋 До свидания!');
      if (this.socket) this.socket.end();
      process.exit(0);
    });
  }
}

// Если запущен как скрипт
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║                 🚀 VPN CLIENT FOR RENDER                 ║
╚══════════════════════════════════════════════════════════╝

📋 Использование:
  node client.js [сервер] [порт]

📝 Примеры:
  node client.js vpn-server-o.onrender.com 10000
  node client.js your-server.onrender.com 3000

🛠️  Если сервер не отвечает:
  1. Откройте в браузере: https://ваш-сервер.onrender.com
  2. Подождите 30-60 секунд для запуска
  3. Проверьте логи на render.com

🔧 Команды в VPN:
  HELP    - Показать команды
  PING    - Проверить соединение
  TIME    - Время сервера
  STATS   - Статистика
  ECHO текст - Эхо
  EXIT    - Выход
`);
    
    // Авто-определение сервера
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('\nВведите адрес вашего сервера (например: vpn-server-o.onrender.com): ', (host) => {
      rl.question('Введите порт (по умолчанию 10000): ', (port) => {
        rl.close();
        
        const finalHost = host.trim() || 'vpn-server-o.onrender.com';
        const finalPort = parseInt(port) || 10000;
        
        startClient(finalHost, finalPort);
      });
    });
  } else {
    const host = args[0];
    const port = parseInt(args[1]) || 10000;
    startClient(host, port);
  }
}

async function startClient(host, port) {
  const client = new VPNClient(host, port);
  
  try {
    await client.connect();
    client.startInteractive();
  } catch (error) {
    console.log('\n🎯 Не удалось подключиться к серверу.');
    console.log('💡 Создайте свой сервер на Render:');
    console.log('1. Зайдите на render.com');
    console.log('2. Создайте Web Service');
    console.log('3. Выберите регион Oregon');
    console.log('4. Загрузите файлы сервера');
    console.log('5. Используйте ваш адрес: ваш-проект.onrender.com\n');
    
    process.exit(1);
  }
}

module.exports = VPNClient;
