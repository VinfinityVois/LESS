#!/bin/bash
# Скрипт первоначальной настройки (Linux/macOS)

set -e

echo "=== LESS Project Init ==="

# Backend
echo "[1/3] Backend virtualenv..."
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cd ..

# Frontend
echo "[2/3] Frontend dependencies..."
cd frontend
npm install
cd ..

echo "[3/3] Done!"
echo ""
echo "Дальше:"
echo "  1. Терминал 1: cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
echo "  2. Терминал 2: cd frontend && npm run tauri dev"
