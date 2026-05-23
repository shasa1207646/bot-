# 🎮 Petushara Team — Бот + Сайт

Discord-бот и сайт для управления заявками на вступление в сервер Petushara Team.

---

## Функционал

### Бот
- Приём заявок на вступление (участник / куратор) — embed с кнопками ✅/❌
- Фильтр нецензурной лексики + логирование нарушений в БД
- Slash-команды: `/ban`, `/kick`, `/mute`, `/violations`, `/create-role`, `/action`, `/help`
- При одобрении заявки — автоматически выдаёт роль «Обзвон» и отправляет ЛС

### Сайт
- Авторизация игроков через Discord OAuth2
- Форма заявки на участника и куратора
- Панель модератора (только для роли «Модератор»): просмотр, одобрение/отклонение заявок
- AI-чат помощник (Claude Haiku)
- Тёмная / светлая тема
- Полные правила сервера (все 17 пунктов §1, §2, §3)

---

## Быстрый старт

### 1. Клонирование и установка
```bash
npm install
```

### 2. Переменные окружения
```bash
cp .env.example .env
# заполните .env своими значениями
```

### 3. Настройка Discord Developer Portal
1. Перейдите на https://discord.com/developers/applications
2. Создайте приложение → вкладка **Bot** → скопируйте токен
3. Вкладка **OAuth2** → скопируйте Client ID и Client Secret
4. В поле **Redirects** добавьте:
   - `https://ВАШ_ДОМЕН/api/player/auth/callback`
   - `https://ВАШ_ДОМЕН/api/moderator/auth/callback`
5. Включите **Intents**: Server Members Intent, Message Content Intent

### 4. Пригласите бота на сервер
```
https://discord.com/oauth2/authorize?client_id=ВАШ_CLIENT_ID&scope=bot+applications.commands&permissions=8
```

### 5. Сборка и запуск
```bash
npm run build
npm start
```

### Разработка (без сборки)
```bash
npm run dev
```

---

## Деплой на Railway

1. Создайте проект на https://railway.app
2. Подключите репозиторий или загрузите папку
3. Добавьте плагин **PostgreSQL** — `DATABASE_URL` подставится автоматически
4. В настройках проекта добавьте все переменные из `.env.example`
5. Railway запустит `npm install && npm run build && npm start` автоматически

---

## Структура проекта

```
├── src/
│   ├── index.ts              # Точка входа
│   ├── app.ts                # Express приложение
│   ├── ai/
│   │   └── chat.ts           # AI-чат (Anthropic Claude Haiku)
│   ├── bot/
│   │   ├── bot.ts            # Discord клиент + фильтр матов
│   │   ├── commands.ts       # Slash-команды
│   │   ├── badwords.ts       # Список запрещённых слов
│   │   ├── discord-lookup.ts # Поиск пользователей Discord
│   │   └── register-commands.ts # Регистрация slash-команд
│   ├── db/
│   │   ├── pool.ts           # PostgreSQL пул соединений
│   │   └── migrations.ts     # Создание таблиц
│   └── routes/
│       ├── player-auth.ts    # OAuth2 для игроков
│       ├── applications.ts   # Заявки участников
│       ├── curator.ts        # Заявки кураторов
│       ├── moderator-auth.ts # OAuth2 для модераторов
│       ├── moderator-panel.ts# Панель модератора (API)
│       └── internal.ts       # AI-чат, healthz, внутренний API
├── public/
│   └── index.html            # Сайт (SPA)
├── .env.example
├── package.json
├── tsconfig.json
└── railway.json
```

---

## Таблицы БД (создаются автоматически)

| Таблица | Описание |
|---|---|
| `applications` | Заявки (участник / куратор) |
| `player_sessions` | Сессии авторизованных игроков |
| `web_mod_sessions` | Сессии модераторов |
| `oauth_states` | CSRF-токены OAuth2 |
| `mutes` | Журнал мутов |
| `bans` | Журнал банов |
| `violations` | Лог нарушений (мат и оскорбления) |

---

## API эндпоинты

### Игрок
| Метод | URL | Описание |
|---|---|---|
| GET | `/api/player/auth` | Получить URL авторизации Discord |
| GET | `/api/player/auth/callback` | OAuth2 callback |
| GET | `/api/player/verify` | Проверить сессию |
| POST | `/api/player/logout` | Выйти |

### Заявки
| Метод | URL | Описание |
|---|---|---|
| POST | `/api/applications` | Подать заявку участника |
| POST | `/api/curator` | Подать заявку куратора |

### Модератор
| Метод | URL | Описание |
|---|---|---|
| POST | `/api/moderator/auth/discord` | Начать OAuth2 для мода |
| GET | `/api/moderator/auth/callback` | OAuth2 callback |
| GET | `/api/moderator/verify` | Проверить сессию мода |
| POST | `/api/moderator/logout` | Выйти |
| GET | `/api/moderator/applications` | Список заявок (фильтры: status, type, page) |
| POST | `/api/moderator/applications/:id/decide` | Одобрить / отклонить (`action: approve\|reject`) |
| GET | `/api/moderator/mutes` | Список мутов |
| GET | `/api/moderator/bans` | Список банов |
| POST | `/api/moderator/mute` | Замутить пользователя |
| POST | `/api/moderator/ban` | Забанить пользователя |
| DELETE | `/api/moderator/mute/:id` | Снять мут |
| DELETE | `/api/moderator/ban/:id` | Снять бан |
| GET | `/api/moderator/channels` | Список каналов |
| GET | `/api/moderator/chat-messages` | Сообщения из Discord-канала |

### Прочее
| Метод | URL | Описание |
|---|---|---|
| POST | `/api/ai/chat` | AI-чат (Claude Haiku) |
| GET | `/api/healthz` | Статус сервера и бота |
| POST | `/api/internal/decision` | Внешнее решение по заявке |
| GET | `/api/internal/pending-applications` | Необработанные заявки |
