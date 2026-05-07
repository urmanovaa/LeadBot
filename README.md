# Kamila Urmanova — AI Automation & Prompt Engineering

**Сайт-визитка AI-специалиста со встроенным AI-ассистентом для консультаций и сбора заявок.**

Я помогаю бизнесу экономить время с помощью AI-ботов, нейросетей и автоматизации процессов. На сайте работает AI-ассистент, который отвечает на вопросы об услугах, помогает сформулировать задачу и передаёт заявку мне.

---

## Что умеет AI-ассистент

- **Консультация по услугам** — отвечает на вопросы о стоимости, сроках, формате работы на основе базы знаний (RAG).
- **Квалификация задачи** — задаёт уточняющие вопросы, понимает контекст и определяет потребности клиента.
- **Сбор заявки** — собирает имя, контакт (Telegram / телефон), получает согласие на обработку данных (152-ФЗ).
- **Уважение отказа** — если клиент не хочет оставлять контакт, бот продолжает консультировать без давления.
- **Защита от дублей** — после оформления заявки повторные сообщения не создают дубли в Google Sheets и Telegram.
- **Google Sheets** — заявки с полной информацией сохраняются в таблицу через webhook.
- **Telegram-уведомления** — мгновенное уведомление о новом лиде через Telegram Bot API.
- **Статусы лидов** — автоматическое определение cold / warm / hot по содержанию диалога.
- **Логирование** — структурированные логи всех событий с performance-метриками.

---

## Стек технологий

| Слой | Технология |
|------|-----------|
| Фреймворк | Next.js 14 (App Router) |
| Язык | TypeScript |
| Стили | Tailwind CSS |
| AI (чат) | OpenAI GPT-4o Mini |
| AI (RAG) | OpenAI text-embedding-3-small |
| Анимации | Framer Motion |
| Иконки | Lucide React |
| Хранение лидов | Google Sheets (Apps Script webhook) |
| Уведомления | Telegram Bot API |
| Деплой | Vercel |

---

## Как работает бот

```
Посетитель открывает чат → AI приветствует → задаёт уточняющие вопросы
→ ищет ответы в базе знаний (RAG) → понимает задачу
→ спрашивает имя → запрашивает контакт → запрашивает согласие
→ сохраняет заявку в Google Sheets → отправляет уведомление в Telegram
```

### Стадии диалога

| Стадия | Что происходит |
|--------|---------------|
| `greeting` | AI представляется, показывает быстрые действия |
| `qualification` | 2–3 уточняющих вопроса о задаче клиента |
| `contact_request` | Сбор имени и контакта (Telegram или телефон) |
| `consent_request` | Согласие по 152-ФЗ |
| `completed` | Заявка сохранена, Telegram-уведомление отправлено |

### Обязательный порядок сбора данных

1. Задача / интерес клиента
2. Имя клиента
3. Контакт (Telegram или телефон)
4. Согласие на обработку данных
5. Сохранение заявки + Telegram-уведомление

Бот не переходит к согласию, пока не собраны имя и контакт. Если контакт получен раньше имени, бот сначала спрашивает имя.

### Поведение при отказе от контакта

Если клиент пишет «не хочу давать номер», бот:
- уважает отказ и не давит;
- продолжает консультировать по задаче;
- не сохраняет заявку и не отправляет Telegram;
- если позже клиент сам оставит контакт — продолжает сценарий.

### Поведение после оформления заявки

После stage `completed`:
- новые сообщения не создают дубли в Google Sheets;
- Telegram-уведомление не отправляется повторно;
- бот отвечает на вопросы как консультант;
- новая заявка создаётся только по явному запросу клиента.

### RAG-поиск

При каждом сообщении пользователя система ищет релевантную информацию в базе знаний:

1. **Основной путь** — cosine similarity по предгенерированным embeddings (text-embedding-3-small)
2. **Fallback** — keyword search по чанкам, если embeddings-индекс недоступен

Embeddings-индекс создаётся один раз скриптом и читается из файла, не генерируется при каждом запросе.

---

## Быстрый старт

### Требования

- Node.js 18+
- Ключ OpenAI API
- URL вебхука Google Apps Script
- Telegram Bot Token и Chat ID (для уведомлений)

### Установка

```bash
git clone https://github.com/urmanovaa/LeadBot.git
cd LeadBot
npm install
```

### Переменные окружения

Скопируйте `.env.example` в `.env.local` и заполните значения:

```bash
cp .env.example .env.local
```

```env
OPENAI_API_KEY=sk-your-key-here
GOOGLE_SCRIPT_WEBHOOK_URL=https://script.google.com/macros/s/your-script-id/exec
TELEGRAM_BOT_TOKEN=123456789:ABC-your-token
TELEGRAM_CHAT_ID=-100your-chat-id
```

### Генерация RAG-индекса

Перед первым запуском сгенерируйте embeddings-индекс базы знаний:

```bash
npm run build:embeddings
```

Индекс сохраняется в `knowledge_base/.cache/embeddings.json`. Перегенерируйте при обновлении файлов в `knowledge_base/`.

### Запуск

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000). Нажмите на иконку чата в правом нижнем углу.

---

## Структура проекта

```
app/
  page.tsx                        Лендинг (сайт-визитка)
  layout.tsx                      Корневой layout
  api/chat/route.ts               AI-чат (RAG + квалификация + лиды)
  api/lead/route.ts               Ручная отправка лида
  api/health/route.ts             Диагностика env-переменных
  api/test-telegram/route.ts      Тест Telegram-уведомлений

components/
  chat/
    chat-widget.tsx               Плавающая кнопка чата
    chat-window.tsx               Основной контейнер чата
    message-bubble.tsx            Компонент сообщения
    chat-input.tsx                Ввод с авто-ресайзом
    quick-actions.tsx             Быстрые действия
    consent-actions.tsx           UI согласия (152-ФЗ)
    typing-indicator.tsx          Анимация набора текста
  landing/
    hero.tsx                      Hero-секция
    features.tsx                  Услуги
    how-it-works.tsx              Процесс работы
    cta.tsx                       Призыв к действию
    footer.tsx                    Подвал с контактами

lib/
  types.ts                        TypeScript-интерфейсы
  openai.ts                       Клиент OpenAI
  prompts.ts                      Системный промпт
  rag.ts                          RAG-поиск (embeddings + keyword fallback)
  knowledge-base.ts               Чтение и чанкинг .md файлов
  contact-parser.ts               Парсер контактов и имён
  lead-summary.ts                 Генератор summary и извлечение данных
  google-sheets.ts                Интеграция с Google Sheets
  telegram.ts                     Telegram Bot API (с timeout 5 сек)
  logger.ts                       Структурированное логирование

knowledge_base/                   16 документов базы знаний (.md)
knowledge_base/.cache/            Предгенерированный embeddings-индекс

scripts/
  build-embeddings.mjs            Генерация embeddings-индекса

prompts/
  system_prompt.md                Описание роли AI-ассистента

docs/
  rag.md                          Документация RAG-системы
  testing.md                      Тестовые сценарии
```

---

## Диагностика (production)

После деплоя на Vercel доступны два endpoint:

- `GET /api/health` — проверка наличия env-переменных (без раскрытия значений)
- `GET /api/test-telegram` — отправка тестового сообщения в Telegram-группу

---

## Обновление базы знаний

1. Добавьте или отредактируйте `.md` файлы в `knowledge_base/`
2. Перегенерируйте индекс: `npm run build:embeddings`
3. Закоммитьте обновлённый `knowledge_base/.cache/embeddings.json`

---

## Деплой на Vercel

1. Подключите репозиторий в Vercel
2. Добавьте переменные окружения в Settings → Environment Variables
3. Закоммитьте `knowledge_base/.cache/embeddings.json` в репозиторий
4. Деплой произойдёт автоматически при push

Embeddings-индекс читается из файла и не генерируется при cold start.

---

## Контакты

**Kamila Urmanova** — AI Automation & Prompt Engineering

- Telegram: [@kamiurrr](https://t.me/kamiurrr)
- Email: camila-urm@yandex.ru

---

**Создано на** Next.js, TypeScript, OpenAI и Google Sheets.

**Лицензия:** MIT
