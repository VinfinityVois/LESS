# Полная установка и запуск LESS через терминал VS Code

Репозиторий: https://github.com/VinfinityVois/LESS.git

## 1. Подготовка

- Git, Node.js 20+, Python 3.11/3.12, Rust (rustup.rs), VS Code + расширения Python, Rust Analyzer, Tauri

## 2. Клонирование

```bash
git clone https://github.com/VinfinityVois/LESS.git
cd LESS
```

## 3. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## 4. Frontend (второй терминал)

```bash
cd frontend
npm install
npm run tauri dev
```

## 5. Ежедневный запуск

Терминал 1 (backend):
```bash
cd backend && source .venv/bin/activate   # или .venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Терминал 2 (frontend):
```bash
cd frontend && npm run tauri dev
```

Подробности и структура — в ARCHITECTURE.md и README.md.
