# LESS — Полная архитектура и скелет проекта

**LESS (Local Entry Security System)** — локальная многофакторная СКУД-система.

Репозиторий: https://github.com/VinfinityVois/LESS.git

---

## 1. Цели системы

- Аутентификация по NFC-картам / браслетам
- Биометрическая проверка по камере (лицо)
- Дополнительный фактор: ПИН-код и/или отпечаток пальца (заглушка)
- Зашифрованное хранение данных (хеши Argon2id + AES-GCM)
- ИИ-анализ логов доступа (аномалии, ошибки, подозрительная активность)
- Десктопное приложение с живым видеопотоком внутри окна

---

## 2. Высокоуровневая архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        Оператор                             │
│                   (Десктопное окно Tauri)                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              Tauri 2 + React 18 + TypeScript                │
│  • Современный UI (Tailwind)                                │
│  • Отображение видеопотока (WebSocket binary JPEG)          │
│  • Статус системы, логи, алерты ИИ                          │
│  • Админ-панель (в разработке)                              │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP REST + WebSocket
                           │ (только 127.0.0.1)
┌──────────────────────────▼──────────────────────────────────┐
│                   Python Backend (FastAPI)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Serial Svc  │  │ Camera Svc   │  │ Auth Engine      │   │
│  │ (Arduino)   │  │ (OpenCV)     │  │ (2FA логика)     │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Crypto Svc  │  │ DB Service   │  │ AI Analyzer      │   │
│  │ Argon2+AES  │  │ SQLite       │  │ (аномалии)       │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Stream Service (рассылка кадров по WebSocket)       │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌────────────┐   ┌────────────┐   ┌────────────┐
   │  Arduino   │   │ USB-камера │   │  skud.db   │
   │ NFC + PIN  │   │            │   │            │
   │ + Finger   │   │            │   │            │
   └────────────┘   └────────────┘   └────────────┘
```

---

## 3. Структура папок (актуальная)

```
LESS/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI + WebSocket
│   │   ├── config.py               # Настройки
│   │   ├── api/                    # (расширение роутов)
│   │   ├── services/
│   │   │   ├── serial_service.py   # Arduino
│   │   │   ├── camera_service.py   # OpenCV
│   │   │   ├── crypto_service.py   # Argon2 + AES-GCM
│   │   │   ├── db_service.py       # SQLite
│   │   │   ├── auth_service.py     # 2FA
│   │   │   ├── ai_analyzer.py      # Правила + статистика
│   │   │   └── stream_service.py   # WebSocket рассылка кадров
│   │   ├── models/
│   │   ├── db/
│   │   └── core/
│   ├── data/                       # skud.db (не в git)
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   │   ├── VideoFeed.tsx       # Живой поток
│   │   │   └── StatusBadge.tsx
│   │   ├── services/
│   │   │   ├── api.ts              # REST клиент
│   │   │   └── websocket.ts        # WS клиент
│   │   ├── stores/
│   │   │   └── systemStore.ts      # Zustand
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── styles/
│   ├── src-tauri/                  # Rust + Tauri 2
│   │   ├── src/main.rs
│   │   ├── src/lib.rs
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   └── build.rs
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── docs/
│   ├── ARCHITECTURE.md             # этот файл
│   └── SETUP_VSCODE.md             # установка через терминал
├── scripts/
└── README.md
```

---

## 4. Потоки данных

### 4.1 Успешный доступ
1. Arduino считывает NFC → Serial → Backend
2. Backend ищет UID в БД
3. Запрашивает второй фактор (лицо / ПИН / отпечаток)
4. При успехе → пишет лог → событие по WebSocket → UI

### 4.2 Видеопоток
1. CameraService читает кадры (OpenCV)
2. Кодирует в JPEG
3. StreamService рассылает binary по WebSocket
4. React создаёт ObjectURL и показывает в `<img>`

### 4.3 ИИ-анализ
- Периодически или по запросу `/api/ai/analyze`
- Правила: много отказов, повторы по одной карте, ночной доступ
- Результат → таблица `ai_alerts` + можно пушить на фронт

---

## 5. Безопасность

- Backend слушает **только 127.0.0.1**
- ПИН / био-шаблоны → Argon2id
- Чувствительные поля можно шифровать AES-256-GCM
- Кадры лиц по умолчанию **не пишутся на диск**
- В будущем: токен между Frontend и Backend

---

## 6. Технологический стек (зафиксированный)

**Backend**
- Python 3.11+
- FastAPI + Uvicorn + WebSockets
- OpenCV + mediapipe
- pyserial
- argon2-cffi + cryptography
- SQLAlchemy / sqlite3 (SQLCipher — следующий этап)
- pandas + scikit-learn
- loguru

**Frontend**
- Tauri 2
- React 18 + TypeScript
- Vite
- Tailwind CSS
- Zustand
- Axios

**Железо**
- Arduino (Uno / Nano / ESP32)
- NFC: RC522 или PN532
- Fingerprint: AS608 / R307 (заглушка)
- USB-веб-камера

---

## 7. Этапы реализации

1. ✅ Каркас проекта + базовый FastAPI + React UI + Tauri
2. ✅ Сервисы: camera, serial, crypto, db, auth, ai, stream
3. 🔄 Подключение реальной камеры + стриминг
4. 🔄 Serial + чтение NFC (Arduino-скетч)
5. Модель пользователей + 2FA end-to-end
6. Шифрование БД (SQLCipher)
7. Улучшение ИИ (IsolationForest / правила + ML)
8. Админ-панель
9. Полировка UI и обработка ошибок

---

*Документ обновлён: 10 ноября 2026*
