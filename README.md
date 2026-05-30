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
- AI-чат помощник (Claude Haiku)
- Тёмная / светлая тема
- Правила сервера

### Панели (новые)
- **`/panel/mod`** — Панель модератора (email + пароль + привязка Discord)
- **`/panel/admin`** — Панель администрации (email + пароль + привязка Discord)
- Просмотр и обработка заявок, жалоб, нарушений, мутов, банов
- Управление ролями Discord

---

## Быстрый старт

### 1. Клонирование и установка
```bash
npm install
```

### 2. Переменные окружения

Создайте `.env` и заполните все переменные:

```env
# Discord бот
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_GUILD_ID=your_guild_id

# ID роли модератора (опционально — если не задан, проверка идёт по названию роли)
DISCORD_MOD_ROLE_ID=

# Redirect URI для каждого OAuth-флоу (должны совпадать с Discord Developer Portal)
DISCORD_PLAYER_REDIRECT_URI=https://ВАШ_ДОМЕН/api/player/auth/callback
DISCORD_MOD_REDIRECT_URI=https://ВАШ_ДОМЕН/api/moderator/auth/callback
DISCORD_PANEL_REDIRECT_URI=https://ВАШ_ДОМЕН/api/panel/auth/callback

# База данных
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Anthropic (AI-чат)
ANTHROPIC_API_KEY=sk-ant-...
```

> ⚠️ **`DISCORD_PANEL_REDIRECT_URI`** — обязательная переменная для работы регистрации в панелях мод/адмін.
> Без неё после привязки Discord пользователя перебрасывает на главную страницу.

### 3. Настройка Discord Developer Portal

1. Перейдите на https://discord.com/developers/applications
2. Создайте приложение → вкладка **Bot** → скопируйте токен
3. Вкладка **OAuth2** → скопируйте Client ID и Client Secret
4. В поле **Redirects** добавьте **все три** URI:
   ```
   https://ВАШ_ДОМЕН/api/player/auth/callback
   https://ВАШ_ДОМЕН/api/moderator/auth/callback
   https://ВАШ_ДОМЕН/api/panel/auth/callback
   ```
5. Включите **Intents**: Server Members Intent, Message Content Intent

> ⚠️ Если не добавить `api/panel/auth/callback` — регистрация в панелях сломана.

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
4. В настройках проекта добавьте **все** переменные из `.env` выше (включая `DISCORD_PANEL_REDIRECT_URI`)
5. Railway запустит `npm install && npm run build && npm start` автоматически

---

## Таблицы БД (создаются автоматически)

| Таблица | Описание |
|---|---|
| `applications` | Заявки (участник / куратор) |
| `player_sessions` | Сессии авторизованных игроков |
| `web_mod_sessions` | Сессии модераторов (старый OAuth-флоу) |
| `oauth_states` | CSRF-токены OAuth2 |
| `mutes` | Журнал мутов |
| `bans` | Журнал банов |
| `violations` | Лог нарушений (мат и оскорбления) |
| `complaints` | Жалобы на игроков |
| `panel_users` | Аккаунты мод/адмін панели (email + пароль) |
| `panel_pending` | Временные записи до привязки Discord |
| `panel_sessions` | Активные сессии панели |

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

### Панель (мод + адмін) — регистрация/вход
| Метод | URL | Описание |
|---|---|---|
| POST | `/api/panel/register` | Шаг 1: регистрация email+пароль → возвращает `discord_url` |
| GET | `/api/panel/auth/callback` | Шаг 2: Discord OAuth callback — создаёт аккаунт |
| POST | `/api/panel/login` | Вход (email + пароль) |
| GET | `/api/panel/verify` | Проверить сессию панели |
| POST | `/api/panel/logout` | Выйти из панели |

### Панель — данные (требует `x-panel-session` заголовок)
| Метод | URL | Доступ | Описание |
|---|---|---|---|
| GET | `/api/panel/applications` | mod+ | Заявки |
| POST | `/api/panel/applications/:id/decide` | mod+ | Одобрить/отклонить заявку |
| GET | `/api/panel/complaints` | mod+ | Жалобы |
| POST | `/api/panel/complaints/:id/resolve` | mod+ | Решить жалобу |
| GET | `/api/panel/violations` | mod+ | Нарушения |
| GET | `/api/panel/status` | admin | Статус бота и сервера |
| GET | `/api/panel/discord-roles` | admin | Роли Discord |
| POST | `/api/panel/discord-roles/assign` | admin | Выдать роль |
| POST | `/api/panel/discord-roles/remove` | admin | Снять роль |
| POST | `/api/panel/discord-roles/create` | admin | Создать роль |
| DELETE | `/api/panel/discord-roles/:id` | admin | Удалить роль |
| GET | `/api/panel/discord-member` | admin | Инфо об участнике |

### Модератор (старый OAuth-флоу через Discord)
| Метод | URL | Описание |
|---|---|---|
| POST | `/api/moderator/auth/discord` | Начать OAuth2 |
| GET | `/api/moderator/auth/callback` | OAuth2 callback |
| GET | `/api/moderator/verify` | Проверить сессию |
| POST | `/api/moderator/logout` | Выйти |
| GET | `/api/moderator/applications` | Список заявок |
| POST | `/api/moderator/applications/:id/decide` | Решение по заявке |
| GET | `/api/moderator/mutes` | Муты |
| GET | `/api/moderator/bans` | Баны |
| POST | `/api/moderator/mute` | Замутить |
| POST | `/api/moderator/ban` | Забанить |
| DELETE | `/api/moderator/mute/:id` | Снять мут |
| DELETE | `/api/moderator/ban/:id` | Снять бан |

### Прочее
| Метод | URL | Описание |
|---|---|---|
| POST | `/api/ai/chat` | AI-чат (Claude Haiku) |
| GET | `/api/healthz` | Статус сервера и бота |
| POST | `/api/internal/decision` | Внешнее решение по заявке |
| GET | `/api/internal/pending-applications` | Необработанные заявки |
