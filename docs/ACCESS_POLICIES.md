# Политики безопасности и контроля доступа

## Обзор

Модуль `app/services/access_policy.py` реализует пять правил:

| Правило | Код отказа | Описание |
|--------|------------|----------|
| Анти-пассбэк | `anti_passback` | Нельзя два раза подряд войти/выйти |
| Временные зоны | `outside_schedule` | Доступ только в заданные часы |
| Гостевой код | `guest_*` | TTL + max_uses |
| Блокировка | `locked_out` | N неудач → бан |
| Дуальный контроль | `dual_*` | 2 человека на критичную дверь |

## API

- `POST /api/access/check` — проверка прохода
- `GET /api/access/doors` — двери и расписания
- `POST /api/access/guest-codes` — создать гостевой код
- `GET /api/access/guest-codes` — список кодов

Подробнее — в репозитории `docs/ACCESS_POLICIES.md` и коде `access_policy.py`.
