# Полная установка и запуск LESS через терминал VS Code

Репозиторий: https://github.com/VinfinityVois/LESS.git

---

## 1. Подготовка (один раз)

### 1.1. Установите необходимое ПО

- **Git** — https://git-scm.com
- **Node.js 20+** (LTS) — https://nodejs.org
- **Python 3.11 или 3.12** — https://python.org
- **Rust** (нужен для Tauri) — https://rustup.rs  
  После установки Rust перезапустите терминал.
- **Visual Studio Code** + расширения:
  - Python
  - Rust Analyzer
  - Tauri
  - ESLint / Prettier (по желанию)

### 1.2. Windows-дополнительно (важно)

Для сборки Tauri на Windows нужен **Microsoft C++ Build Tools** и WebView2 (обычно уже есть в Windows 10/11).

---

## 2. Клонирование репозитория

Откройте **VS Code** → Terminal → New Terminal (`` Ctrl+` ``)

```bash
# Перейдите в папку, где хотите хранить проекты
cd ~/Projects          # или C:\Users\ВашеИмя\Projects

# Клонируем репозиторий
git clone https://github.com/VinfinityVois/LESS.git
cd LESS
```

Если репозиторий ещё пустой (только Initial commit), то после клонирования мы заполним его файлами из этого каркаса.

---

## 3. Backend (Python)

```bash
# Создаём виртуальное окружение
cd backend
python -m venv .venv

# Активируем
# Windows:
.venv\Scripts\activate
# Linux / macOS:
source .venv/bin/activate

# Ставим зависимости
pip install --upgrade pip
pip install -r requirements.txt
```

### Проверка backend

```bash
# Из папки backend (с активированным venv)
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Откройте в браузере: http://127.0.0.1:8000  
Должно появиться: `{"service":"LESS Backend","version":"0.1.0","status":"running"}`

Оставьте этот терминал работать.

---

## 4. Frontend (Tauri + React)

Откройте **второй терминал** в VS Code.

```bash
cd frontend

# Устанавливаем npm-зависимости
npm install

# Первый запуск Tauri (создаст src-tauri если нужно)
# Если папка src-tauri уже есть — просто:
npm run tauri dev
```

При первом запуске `tauri dev` может спросить подтверждения и скачать зависимости Rust. Это нормально, подождите.

После запуска откроется окно приложения LESS.

---

## 5. Если репозиторий был пустым — как залить каркас

Если вы клонировали только Initial commit, скопируйте все файлы из подготовленного каркаса в клонированную папку `LESS`, затем:

```bash
cd LESS
git add .
git status
git commit -m "feat: initial project skeleton (Python backend + Tauri React)"
git push origin main
```

---

## 6. Ежедневный запуск (два терминала)

**Терминал 1 — Backend:**
```bash
cd backend
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Терминал 2 — Frontend:**
```bash
cd frontend
npm run tauri dev
```

---

## 7. Полезные команды

| Действие                    | Команда                              |
|----------------------------|--------------------------------------|
| Обновить Python-зависимости| `pip install -r requirements.txt`    |
| Обновить npm-зависимости   | `npm install`                        |
| Собрать production-версию  | `npm run tauri build`                |
| Проверить порты Serial     | В Python: `python -c "from app.services.serial_service import serial_service; print(serial_service.list_ports())"` |

---

## 8. Структура после установки

```
LESS/
├── backend/
│   ├── .venv/                 ← виртуальное окружение (не коммитится)
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── services/
│   │   │   ├── camera_service.py
│   │   │   ├── serial_service.py
│   │   │   └── crypto_service.py
│   │   └── ...
│   └── requirements.txt
│
├── frontend/
│   ├── node_modules/          ← не коммитится
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── VideoFeed.tsx
│   │   │   └── StatusBadge.tsx
│   │   └── ...
│   ├── src-tauri/             ← Rust-часть Tauri
│   └── package.json
│
└── docs/
    └── SETUP_VSCODE.md        ← этот файл
```

---

## 9. Следующие шаги разработки

1. Подключить реальную камеру и стриминг кадров по WebSocket.
2. Реализовать чтение NFC с Arduino.
3. Сделать модель пользователей и зашифрованную БД.
4. Добавить 2FA-логику.
5. Подключить ИИ-анализатор логов.

---

**Готово.** После выполнения шагов у вас будет полностью рабочий каркас проекта, готовый к дальнейшей разработке.
