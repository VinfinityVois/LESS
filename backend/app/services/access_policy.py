"""
Политики безопасности и контроля доступа LESS.

1. Анти-пассбэк
2. Временные зоны
3. Гостевые QR / одноразовые коды
4. Блокировка после N неудач
5. Дуальный контроль
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta, time
from typing import Optional, Dict, Any, List, Tuple
from enum import Enum
from loguru import logger
import secrets
import hashlib
from app.config import settings
from app.services.db_service import db_service


class Direction(str, Enum):
    IN = "in"
    OUT = "out"


class AccessDecision(str, Enum):
    ALLOW = "allow"
    DENY = "deny"


@dataclass
class AccessContext:
    nfc_uid: Optional[str] = None
    user_id: Optional[int] = None
    door_id: str = "main"
    direction: Direction = Direction.IN
    guest_code: Optional[str] = None
    second_user_id: Optional[int] = None
    factor: str = "nfc"
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class AccessResult:
    decision: AccessDecision
    reason: str
    code: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TimeWindow:
    start: time
    end: time
    weekdays: Tuple[int, ...] = (0, 1, 2, 3, 4)


@dataclass
class DoorPolicy:
    door_id: str
    name: str = ""
    anti_passback: bool = True
    dual_control: bool = False
    schedule: List[TimeWindow] = field(default_factory=list)


class AccessPolicyService:
    def __init__(self):
        self.doors: Dict[str, DoorPolicy] = {
            "main": DoorPolicy(
                door_id="main",
                name="Главный вход",
                anti_passback=True,
                dual_control=False,
                schedule=[
                    TimeWindow(time(8, 0), time(20, 0), weekdays=(0, 1, 2, 3, 4)),
                    TimeWindow(time(10, 0), time(16, 0), weekdays=(5,)),
                ],
            ),
            "server_room": DoorPolicy(
                door_id="server_room",
                name="Серверная",
                anti_passback=True,
                dual_control=True,
                schedule=[TimeWindow(time(9, 0), time(18, 0), weekdays=(0, 1, 2, 3, 4))],
            ),
        }
        self._last_direction: Dict[Tuple[int, str], Direction] = {}
        self._failed_attempts: Dict[str, List[datetime]] = {}
        self._locked_until: Dict[str, datetime] = {}
        self._guest_codes: Dict[str, Dict[str, Any]] = {}
        self._dual_pending: Dict[str, Dict[str, Any]] = {}
        self.max_failed_attempts = getattr(settings, "AI_FAILED_ATTEMPTS_THRESHOLD", 5)
        self.lockout_minutes = 15
        self.failed_window_minutes = 30
        self.dual_timeout_seconds = 60

    def evaluate(self, ctx: AccessContext) -> AccessResult:
        subject = self._subject_key(ctx)
        r = self._check_lockout(subject, ctx)
        if r.decision == AccessDecision.DENY:
            return r
        if ctx.guest_code:
            r = self._check_guest_code(ctx)
            if r.decision == AccessDecision.DENY:
                self._register_failure(subject, ctx)
                return r
        elif ctx.user_id is None and not ctx.nfc_uid:
            return AccessResult(AccessDecision.DENY, "Нет идентификатора", "no_identity")
        door = self.doors.get(ctx.door_id)
        if not door:
            return AccessResult(AccessDecision.DENY, f"Неизвестная дверь: {ctx.door_id}", "unknown_door")
        r = self._check_schedule(door, ctx)
        if r.decision == AccessDecision.DENY:
            self._register_failure(subject, ctx)
            return r
        if door.anti_passback and ctx.user_id is not None:
            r = self._check_anti_passback(door, ctx)
            if r.decision == AccessDecision.DENY:
                self._register_failure(subject, ctx)
                return r
        if door.dual_control:
            r = self._check_dual_control(door, ctx)
            if r.decision == AccessDecision.DENY:
                return r
        self._on_success(ctx, door)
        return AccessResult(
            AccessDecision.ALLOW, "Доступ разрешён", "ok",
            details={"door_id": ctx.door_id, "direction": ctx.direction.value, "user_id": ctx.user_id},
        )

    def register_denied(self, ctx: AccessContext, reason: str = "") -> None:
        self._register_failure(self._subject_key(ctx), ctx)

    def create_guest_code(self, label: str = "Гость", valid_hours: float = 2.0, max_uses: int = 1, door_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        return db_service.create_guest_pass(label, valid_hours, max_uses, door_ids or ["main"])

    def list_guest_codes(self) -> List[Dict[str, Any]]:
        return db_service.list_guest_passes()

    def _subject_key(self, ctx: AccessContext) -> str:
        if ctx.user_id is not None:
            return f"user:{ctx.user_id}"
        if ctx.nfc_uid:
            return f"nfc:{ctx.nfc_uid}"
        if ctx.guest_code:
            return f"guest:{self._hash_code(ctx.guest_code)[:12]}"
        return "unknown"

    def _check_lockout(self, subject: str, ctx: AccessContext) -> AccessResult:
        until = self._locked_until.get(subject)
        if until and ctx.now < until:
            left = int((until - ctx.now).total_seconds() // 60) + 1
            return AccessResult(AccessDecision.DENY, f"Заблокирован ещё ~{left} мин", "locked_out", details={"locked_until": until.isoformat()})
        if until and ctx.now >= until:
            self._locked_until.pop(subject, None)
            self._failed_attempts.pop(subject, None)
        return AccessResult(AccessDecision.ALLOW, "", "ok")

    def _register_failure(self, subject: str, ctx: AccessContext) -> None:
        now = ctx.now
        window_start = now - timedelta(minutes=self.failed_window_minutes)
        attempts = [t for t in self._failed_attempts.get(subject, []) if t >= window_start]
        attempts.append(now)
        self._failed_attempts[subject] = attempts
        if len(attempts) >= self.max_failed_attempts:
            self._locked_until[subject] = now + timedelta(minutes=self.lockout_minutes)
            logger.warning(f"LOCKOUT subject={subject} after {len(attempts)} failures")
            self._notify_admin_lockout(subject, len(attempts))

    def _notify_admin_lockout(self, subject: str, count: int) -> None:
        logger.error(f"[ADMIN ALERT] Lockout: {subject}, failed={count}")

    def _check_schedule(self, door: DoorPolicy, ctx: AccessContext) -> AccessResult:
        if not door.schedule:
            return AccessResult(AccessDecision.ALLOW, "", "ok")
        local = ctx.now.astimezone()
        wd, t = local.weekday(), local.time()
        for w in door.schedule:
            if wd in w.weekdays and w.start <= t < w.end:
                return AccessResult(AccessDecision.ALLOW, "", "ok")
        return AccessResult(AccessDecision.DENY, f"Вне расписания «{door.name}»", "outside_schedule", details={"door_id": door.door_id})

    def _check_anti_passback(self, door: DoorPolicy, ctx: AccessContext) -> AccessResult:
        if ctx.user_id is None:
            return AccessResult(AccessDecision.ALLOW, "", "ok")
        key = (ctx.user_id, door.door_id)
        last = self._last_direction.get(key)
        if last is None:
            return AccessResult(AccessDecision.ALLOW, "", "ok")
        if last == ctx.direction:
            needed = Direction.OUT if last == Direction.IN else Direction.IN
            return AccessResult(AccessDecision.DENY, f"Анти-пассбэк: ожидается «{needed.value}»", "anti_passback", details={"last": last.value, "requested": ctx.direction.value})
        return AccessResult(AccessDecision.ALLOW, "", "ok")

    def _check_dual_control(self, door: DoorPolicy, ctx: AccessContext) -> AccessResult:
        if ctx.user_id is None:
            return AccessResult(AccessDecision.DENY, "Dual: нужен пользователь", "dual_no_user")
        pending = self._dual_pending.get(door.door_id)
        now = ctx.now
        if not pending:
            self._dual_pending[door.door_id] = {"user_id": ctx.user_id, "nfc_uid": ctx.nfc_uid, "ts": now, "direction": ctx.direction}
            return AccessResult(AccessDecision.DENY, "Дуальный контроль: ожидание второго (60 сек)", "dual_waiting", details={"first_user_id": ctx.user_id})
        if (now - pending["ts"]).total_seconds() > self.dual_timeout_seconds:
            self._dual_pending[door.door_id] = {"user_id": ctx.user_id, "nfc_uid": ctx.nfc_uid, "ts": now, "direction": ctx.direction}
            return AccessResult(AccessDecision.DENY, "Dual: таймаут, вы первый — ждём второго", "dual_waiting", details={"first_user_id": ctx.user_id})
        if pending["user_id"] == ctx.user_id:
            return AccessResult(AccessDecision.DENY, "Dual: нужен другой сотрудник", "dual_same_person")
        self._dual_pending.pop(door.door_id, None)
        return AccessResult(AccessDecision.ALLOW, "Дуальный контроль пройден", "ok", details={"first_user_id": pending["user_id"], "second_user_id": ctx.user_id})

    def _check_guest_code(self, ctx: AccessContext) -> AccessResult:
        meta = db_service.get_guest_pass_by_code(ctx.guest_code or "")
        if not meta:
            return AccessResult(AccessDecision.DENY, "Неверный гостевой код", "guest_invalid")
        if meta["status"] == "blocked":
            return AccessResult(AccessDecision.DENY, "Гостевой пропуск заблокирован", "guest_blocked")
        if meta["status"] != "active":
            return AccessResult(AccessDecision.DENY, "Гостевой пропуск закрыт", "guest_closed")
        if datetime.fromisoformat(meta["expires_at"]) <= ctx.now:
            return AccessResult(AccessDecision.DENY, "Гостевой код истёк", "guest_expired")
        if meta["uses"] >= meta["max_uses"]:
            return AccessResult(AccessDecision.DENY, "Лимит проходов исчерпан", "guest_exhausted")
        if ctx.door_id not in meta["door_ids"]:
            return AccessResult(AccessDecision.DENY, "Код не для этой двери", "guest_wrong_door")
        if not db_service.consume_guest_pass(meta["id"]):
            return AccessResult(AccessDecision.DENY, "Пропуск уже использован или отключён", "guest_unavailable")
        return AccessResult(AccessDecision.ALLOW, "Гостевой код принят", "ok", details={"label": meta["label"], "uses_left": meta["max_uses"] - meta["uses"] - 1})

    def _on_success(self, ctx: AccessContext, door: DoorPolicy) -> None:
        if ctx.user_id is not None and door.anti_passback:
            self._last_direction[(ctx.user_id, door.door_id)] = ctx.direction
        subject = self._subject_key(ctx)
        self._failed_attempts.pop(subject, None)
        self._locked_until.pop(subject, None)

    @staticmethod
    def _hash_code(raw: str) -> str:
        return hashlib.sha256(raw.strip().upper().encode()).hexdigest()


access_policy = AccessPolicyService()
