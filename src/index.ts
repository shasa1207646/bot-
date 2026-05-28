import 'dotenv/config';
import app from './app';
import { startDiscordBot } from './bot/bot';
import { registerCommands } from './bot/register-commands';
import { runMigrations } from './db/migrations';
import { startTelegramBot } from './telegram-bot';

process.on('uncaughtException',  (err)    => console.error('[Main] Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('[Main] Unhandled Rejection:', reason));

const PORT = parseInt(process.env.PORT || '8080', 10);

async function main() {
  // 1. Миграции БД
  try {
    await runMigrations();
  } catch (err) {
    console.error('[Main] Ошибка миграций:', err);
  }

  // 2. Discord бот
  startDiscordBot();

  // 3. Slash-команды (через 3 сек, чтобы бот успел подключиться)
  setTimeout(() => {
    registerCommands().catch(console.error);
  }, 3000);

  // 4. Telegram бот (через 2 сек после Discord)
  setTimeout(() => {
    startTelegramBot();
  }, 2000);

  // 5. HTTP сервер
  app.listen(PORT, () => {
    console.log(`[Main] Сервер запущен на порту ${PORT}`);
  });
}

main();
