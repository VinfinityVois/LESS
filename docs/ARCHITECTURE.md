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
[Оператор] → Tauri + React Frontend → HTTP/WS (127.0.0.1) → Python FastAPI Backend
 Backend: Serial (Arduino) | Camera (OpenCV) | Auth (2FA) | Crypto (Argon2+AES) | DB | AI Analyzer | Stream
```

Полная детальная версия и структура папок — см. локальный файл в artifacts или после полного пуша.

---

## 3. Стек

- Backend: Python 3.11+, FastAPI, OpenCV, mediapipe, pyserial, argon2-cffi, cryptography, SQLAlchemy/sqlite3, pandas, scikit-learn, loguru
- Frontend: Tauri 2, React 18, TypeScript, Vite, Tailwind, Zustand, Axios
- Железо: Arduino + NFC (RC522/PN532) + fingerprint stub + USB-камера

---

## 4. Этапы

1. ✅ Каркас + FastAPI + React + Tauri
2. ✅ Сервисы camera/serial/crypto/db/auth/ai/stream
3. 🔄 Подключение реальной камеры + стриминг
4. Serial + NFC
5. 2FA end-to-end
6. SQLCipher
7. Улучшение ИИ
8. Админ-панель

*Обновлено 10 ноября 2026*
