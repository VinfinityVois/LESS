# LESS — Local Entry Security System

**Многофакторная СКУД-система** с NFC, биометрией (камера + отпечаток), ПИН-кодом, зашифрованной БД и ИИ-анализом аномалий.

Репозиторий: https://github.com/VinfinityVois/LESS.git

## Стек

| Слой              | Технология                                      |
|-------------------|-------------------------------------------------|
| Backend           | Python 3.11+ / FastAPI / OpenCV / mediapipe     |
| Frontend          | Tauri 2 + React 18 + TypeScript + Tailwind      |
| База данных       | SQLite (SQLCipher — следующий этап)             |
| Криптография      | Argon2id + AES-256-GCM                          |
| Железо            | Arduino (NFC RC522/PN532, fingerprint stub)     |
| Связь             | pyserial + WebSocket (видеопоток JPEG)          |

## Быстрый старт (VS Code Terminal)

Подробная пошаговая инструкция:

→ **[docs/SETUP_VSCODE.md](docs/SETUP_VSCODE.md)**

Кратко:

```bash
# 1. Клонировать
git clone https://github.com/VinfinityVois/LESS.git
cd LESS

# 2. Backend
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# 3. Frontend (второй терминал)
cd frontend
npm install
npm run tauri dev
```

## Структура

```
LESS/
├── backend/          # Python (логика, камера, Serial, AI, крипта)
├── frontend/         # Tauri + React UI
├── docs/             # Архитектура и установка
└── scripts/
```

## Документация

- [Полная архитектура](docs/ARCHITECTURE.md)
- [Установка через терминал VS Code](docs/SETUP_VSCODE.md)

## Статус

Каркас полностью развёрнут:
- Backend сервисы (camera, serial, crypto, db, auth, ai, stream)
- FastAPI + WebSocket
- React UI + VideoFeed (готов к приёму JPEG-кадров)
- Tauri 2 конфигурация

Следующие шаги — подключение реальной камеры и Arduino.
