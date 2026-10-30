"""RFID Gym Membership API (FastAPI).

Run locally:  uvicorn main:app --reload
Render start: uvicorn main:app --host 0.0.0.0 --port $PORT
"""
import calendar
import hashlib
import hmac
import math
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import (Boolean, Column, DateTime, ForeignKey, Integer, String,
                        create_engine, inspect, text)
from sqlalchemy.orm import Session, declarative_base, sessionmaker

# ---------------------------------------------------------------- config
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./gym.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)  # set it on Render!
KIOSK_KEY = os.getenv("KIOSK_KEY", "")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin").strip().lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")  # if unset -> "admin123" + forced change
ORIGINS = [o.strip() for o in os.getenv("FRONTEND_ORIGIN", "*").split(",") if o.strip()]
STALE_SESSION_HOURS = 12  # an open session older than this is treated as a forgotten check-out

engine = create_engine(
    DATABASE_URL, pool_pre_ping=True,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


# ---------------------------------------------------------------- models
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    role = Column(String(10), default="member", index=True)  # admin | member
    name = Column(String(80), nullable=False)
    username = Column(String(60), unique=True, nullable=False, index=True)
    password_hash = Column(String(200), nullable=False)
    must_change_password = Column(Boolean, default=True)
    uid = Column(String(40), unique=True, nullable=True, index=True)
    joined_at = Column(DateTime, default=now)
    expires_at = Column(DateTime, nullable=True)
    plan_days = Column(Integer, default=30)  # length of the latest paid period (for the progress ring)
    months_paid = Column(Integer, default=0)  # lifetime months paid
    banned = Column(Boolean, default=False)
    token = Column(String(64), nullable=True)  # secret written onto the card (never shown in the UI)
    card_secured = Column(Boolean, default=False)  # True once the token was written to the physical card


class Attendance(Base):
    __tablename__ = "attendance"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    check_in = Column(DateTime, default=now, index=True)
    check_out = Column(DateTime, nullable=True)
    auto_closed = Column(Boolean, default=False)


class UnregisteredScan(Base):
    __tablename__ = "unregistered_scans"
    uid = Column(String(40), primary_key=True)
    last_seen = Column(DateTime, default=now)
    count = Column(Integer, default=1)


class SdStatus(Base):  # single row (id=1) reported by the gym PC / Arduino
    __tablename__ = "sd_status"
    id = Column(Integer, primary_key=True)
    ok = Column(Boolean, default=False)
    used_kb = Column(Integer, default=0)
    total_kb = Column(Integer, default=0)
    updated_at = Column(DateTime, nullable=True)  # None until the kiosk reports for the first time


# ---------------------------------------------------------------- security
def hash_pw(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return salt.hex() + "$" + h.hex()


def check_pw(pw: str, stored: str) -> bool:
    try:
        salt, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
        return hmac.compare_digest(calc.hex(), h)
    except Exception:
        return False


def make_token(u: User) -> str:
    exp = now() + timedelta(hours=12)
    return jwt.encode({"sub": str(u.id), "role": u.role, "exp": exp}, SECRET_KEY, algorithm="HS256")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Not logged in")
    try:
        data = jwt.decode(authorization[7:], SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired, please log in again")
    u = db.get(User, int(data["sub"]))
    if not u:
        raise HTTPException(401, "Account no longer exists")
    if u.banned:
        raise HTTPException(403, "This account has been banned")
    return u


def admin_only(u: User = Depends(current_user)) -> User:
    if u.role != "admin":
        raise HTTPException(403, "Admins only")
    return u


def kiosk_auth(x_kiosk_key: str = Header(None)):
    if not KIOSK_KEY:
        raise HTTPException(503, "KIOSK_KEY is not configured on the server")
    if not hmac.compare_digest(x_kiosk_key or "", KIOSK_KEY):
        raise HTTPException(401, "Wrong kiosk key")


# ---------------------------------------------------------------- helpers
def norm_uid(raw: str) -> str:
    h = re.sub(r"[^0-9A-Fa-f]", "", raw or "").upper()
    if len(h) < 8 or len(h) % 2:
        raise HTTPException(422, "Card UID looks invalid (expected e.g. A1 B2 C3 D4)")
    return " ".join(h[i:i + 2] for i in range(0, len(h), 2))


def add_months(dt: datetime, m: int) -> datetime:
    y = dt.year + (dt.month - 1 + m) // 12
    mo = (dt.month - 1 + m) % 12 + 1
    return dt.replace(year=y, month=mo, day=min(dt.day, calendar.monthrange(y, mo)[1]))


def days_left(u: User) -> int:
    if not u.expires_at:
        return 0
    return max(0, math.ceil((u.expires_at - now()).total_seconds() / 86400))


def status_of(u: User) -> str:
    return "banned" if u.banned else ("expired" if days_left(u) <= 0 else "active")


def default_password() -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def make_username(db: Session, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".")[:24] or "member"
    while True:
        cand = f"{base}{secrets.randbelow(900) + 100}"
        if not db.query(User).filter_by(username=cand).first():
            return cand


def open_session(db: Session, uid: int) -> Optional[Attendance]:
    return (db.query(Attendance).filter_by(user_id=uid, check_out=None)
            .order_by(Attendance.check_in.desc()).first())


def user_out(u: User, in_gym: bool = False) -> dict:
    return {
        "id": u.id, "role": u.role, "name": u.name, "username": u.username, "uid": u.uid,
        "status": status_of(u), "banned": bool(u.banned), "days_left": days_left(u),
        "plan_days": u.plan_days or 30, "months_paid": u.months_paid or 0,
        "joined_at": iso(u.joined_at), "expires_at": iso(u.expires_at),
        "must_change_password": bool(u.must_change_password), "in_gym": in_gym,
        "card_secured": bool(u.card_secured),
    }


def fmt_dur(sec: float) -> str:
    m = int(sec // 60)
    return f"{m // 60}h{m % 60:02d}m"


def lcd_safe(s: str) -> str:
    return s.encode("ascii", "ignore").decode()[:16]


def analytics(db: Session, u: User, tz: int) -> dict:
    n, off = now(), timedelta(minutes=tz)
    rows = db.query(Attendance).filter_by(user_id=u.id).order_by(Attendance.check_in.desc()).all()

    def secs(a: Attendance) -> float:
        end = a.check_out or min(n, a.check_in + timedelta(hours=STALE_SESSION_HOURS))
        return max(0.0, (end - a.check_in).total_seconds())

    total = sum(secs(a) for a in rows)
    week = sum(secs(a) for a in rows if a.check_in >= n - timedelta(days=7))
    month = sum(secs(a) for a in rows if a.check_in >= n - timedelta(days=30))
    visits_month = sum(1 for a in rows if a.check_in >= n - timedelta(days=30))
    closed = [a for a in rows if a.check_out and not a.auto_closed]
    avg = (sum(secs(a) for a in closed) / len(closed)) if closed else 0
    today = (n + off).date()
    daily = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        s = sum(secs(a) for a in rows if (a.check_in + off).date() == d)
        daily.append({"date": d.isoformat(), "hours": round(s / 3600, 2)})
    cur = open_session(db, u.id)
    return {
        "hours_week": round(week / 3600, 1), "hours_month": round(month / 3600, 1),
        "hours_total": round(total / 3600, 1), "visits_total": len(rows),
        "visits_month": visits_month, "avg_session_min": round(avg / 60),
        "in_gym_since": iso(cur.check_in) if cur else None, "daily": daily,
        "sessions": [{"check_in": iso(a.check_in), "check_out": iso(a.check_out),
                      "minutes": round(secs(a) / 60), "open": a.check_out is None}
                     for a in rows[:20]],
    }


# ---------------------------------------------------------------- app
app = FastAPI(title="RFID Gym API")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])


def migrate():
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    with engine.begin() as con:
        if "token" not in cols:
            con.execute(text("ALTER TABLE users ADD COLUMN token VARCHAR(64)"))
        if "card_secured" not in cols:
            con.execute(text("ALTER TABLE users ADD COLUMN card_secured BOOLEAN DEFAULT FALSE"))


@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)
    migrate()
    db = SessionLocal()
    try:
        if not db.query(User).filter_by(role="admin").first():
            db.add(User(role="admin", name="Administrator", username=ADMIN_USERNAME,
                        password_hash=hash_pw(ADMIN_PASSWORD or "admin123"),
                        must_change_password=ADMIN_PASSWORD is None))
            db.commit()
        if not db.get(SdStatus, 1):
            db.add(SdStatus(id=1))
            db.commit()
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"ok": True}


# ---- auth
class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=100)


@app.post("/api/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(username=body.username.strip().lower()).first()
    if not u or not check_pw(body.password, u.password_hash):
        raise HTTPException(401, "Wrong username or password")
    if u.banned:
        raise HTTPException(403, "This account has been banned. Please see the front desk.")
    return {"token": make_token(u), "user": user_out(u)}


@app.get("/api/me")
def me(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_out(u, open_session(db, u.id) is not None)


@app.post("/api/me/password")
def change_password(body: PasswordIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if not check_pw(body.current_password, u.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(400, "Choose a different password")
    u.password_hash, u.must_change_password = hash_pw(body.new_password), False
    db.commit()
    return {"ok": True}


@app.get("/api/me/analytics")  # read-only analysis for members
def my_analytics(tz: int = Query(0), u: User = Depends(current_user), db: Session = Depends(get_db)):
    return analytics(db, u, tz)


# ---- kiosk (scanner)
class ScanIn(BaseModel):
    uid: str
    token: Optional[str] = None  # secret read from the card by the Arduino


class SecuredIn(BaseModel):
    uid: str


class SdIn(BaseModel):
    ok: bool
    used_kb: int = Field(ge=0)
    total_kb: int = Field(ge=0)


@app.post("/api/scan", dependencies=[Depends(kiosk_auth)])
def scan(body: ScanIn, db: Session = Depends(get_db)):
    uid = norm_uid(body.uid)
    u = db.query(User).filter_by(uid=uid, role="member").first()

    def reply(result, l1, l2, msg, **extra):
        return {"result": result, "message": msg, "lcd": [lcd_safe(l1), lcd_safe(l2)],
                "name": u.name if u else None, "days_left": days_left(u) if u else None, **extra}

    if not u:
        r = db.get(UnregisteredScan, uid)
        if r:
            r.last_seen, r.count = now(), (r.count or 0) + 1
        else:
            db.add(UnregisteredScan(uid=uid))
        db.commit()
        return reply("unregistered", "CARD NOT", "REGISTERED", "This card is not registered. See the front desk.")
    if not u.card_secured:  # first tap: write a secret onto the card (no check-in yet)
        if not u.token:
            u.token = secrets.token_hex(16)
            db.commit()
        return reply("provision", "SECURING CARD", "KEEP ON READER",
                     "Securing your card. Keep it on the reader.", provision_token=u.token)
    if not body.token or not hmac.compare_digest(body.token.lower(), (u.token or "").lower()):
        return {"result": "invalid_card", "message": "Invalid card. Please see the front desk.",
                "lcd": ["INVALID CARD", "SEE FRONT DESK"], "name": None, "days_left": None}
    if u.banned:
        return reply("banned", u.name, "ACCESS DENIED", "Your account is banned. Please see the front desk.")
    left = days_left(u)
    if left <= 0:
        return reply("expired", u.name, "MEMBERSHIP ENDED", "Your membership has expired. Please renew.")

    s, t = open_session(db, u.id), now()
    if s and t - s.check_in > timedelta(hours=STALE_SESSION_HOURS):
        s.check_out, s.auto_closed = s.check_in, True  # forgot to tap out last time
        s = None
    if s and t - s.check_in < timedelta(seconds=10):  # double tap
        return reply("checked_in", u.name, f"IN  {left}d left", f"Already checked in. {left} day(s) left.")
    if s:
        s.check_out = t
        dur = fmt_dur((t - s.check_in).total_seconds())
        db.commit()
        return reply("checked_out", u.name, f"OUT {dur} {left}d", f"Checked out. Workout time: {dur}.", duration=dur)
    db.add(Attendance(user_id=u.id, check_in=t))
    db.commit()
    return reply("checked_in", u.name, f"IN  {left}d left", f"Welcome! Checked in. {left} day(s) left.")


@app.post("/api/kiosk/secured", dependencies=[Depends(kiosk_auth)])
def card_secured(body: SecuredIn, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(uid=norm_uid(body.uid), role="member").first()
    if not u:
        raise HTTPException(404, "Card not registered")
    u.card_secured = True
    db.commit()
    return {"ok": True}


@app.post("/api/kiosk/storage", dependencies=[Depends(kiosk_auth)])
def report_storage(body: SdIn, db: Session = Depends(get_db)):
    row = db.get(SdStatus, 1)
    row.ok, row.used_kb, row.total_kb, row.updated_at = body.ok, body.used_kb, body.total_kb, now()
    db.commit()
    return {"ok": True}


# ---- admin
class MemberIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    uid: str
    months: int = Field(ge=1, le=36)


class RenewIn(BaseModel):
    months: int = Field(ge=1, le=36)


class BanIn(BaseModel):
    banned: bool


def sd_info(db: Session) -> dict:
    r = db.get(SdStatus, 1)
    pct = round(100 * r.used_kb / r.total_kb, 1) if r.total_kb else 0
    stale = (now() - r.updated_at) > timedelta(minutes=15) if r.updated_at else True
    if r.updated_at is None:
        state = "unknown"
    elif not r.ok:
        state = "missing"
    elif pct >= 98:
        state = "full"
    elif pct >= 85:
        state = "warn"
    else:
        state = "ok"
    return {"state": state, "used_kb": r.used_kb, "total_kb": r.total_kb, "percent": pct,
            "updated_at": iso(r.updated_at), "stale": stale}


@app.get("/api/admin/overview")
def overview(tz: int = Query(0), _: User = Depends(admin_only), db: Session = Depends(get_db)):
    members = db.query(User).filter_by(role="member").all()
    n, off = now(), timedelta(minutes=tz)
    start_utc = (n + off).replace(hour=0, minute=0, second=0, microsecond=0) - off
    return {
        "total": len(members),
        "active": sum(1 for m in members if status_of(m) == "active"),
        "expired": sum(1 for m in members if status_of(m) == "expired"),
        "banned": sum(1 for m in members if m.banned),
        "expiring_soon": sum(1 for m in members if status_of(m) == "active" and days_left(m) <= 7),
        "in_gym": db.query(Attendance).filter_by(check_out=None).count(),
        "visits_today": db.query(Attendance).filter(Attendance.check_in >= start_utc).count(),
        "attendance_rows": db.query(Attendance).count(),
        "sd": sd_info(db),
    }


@app.get("/api/admin/members")
def list_members(_: User = Depends(admin_only), db: Session = Depends(get_db)):
    inside = {a.user_id for a in db.query(Attendance).filter_by(check_out=None).all()}
    ms = db.query(User).filter_by(role="member").order_by(User.joined_at.desc()).all()
    return [user_out(m, m.id in inside) for m in ms]


@app.post("/api/admin/members")
def register_member(body: MemberIn, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    uid = norm_uid(body.uid)
    if db.query(User).filter_by(uid=uid).first():
        raise HTTPException(409, "This card is already registered to another member")
    t = now()
    exp = add_months(t, body.months)
    pw = default_password()
    u = User(role="member", name=body.name.strip(), username=make_username(db, body.name),
             password_hash=hash_pw(pw), must_change_password=True, uid=uid, joined_at=t,
             token=secrets.token_hex(16), card_secured=False,
             expires_at=exp, plan_days=(exp - t).days, months_paid=body.months)
    db.add(u)
    old = db.get(UnregisteredScan, uid)
    if old:
        db.delete(old)
    db.commit()
    return {"member": user_out(u), "default_password": pw}


def get_member(db: Session, mid: int) -> User:
    u = db.get(User, mid)
    if not u or u.role != "member":
        raise HTTPException(404, "Member not found")
    return u


@app.post("/api/admin/members/{mid}/renew")
def renew(mid: int, body: RenewIn, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    u = get_member(db, mid)
    base = u.expires_at if u.expires_at and u.expires_at > now() else now()
    u.expires_at = add_months(base, body.months)
    u.plan_days = max(1, (u.expires_at - now()).days)
    u.months_paid = (u.months_paid or 0) + body.months
    db.commit()
    return user_out(u)


@app.post("/api/admin/members/{mid}/ban")
def ban(mid: int, body: BanIn, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    u = get_member(db, mid)
    u.banned = body.banned
    db.commit()
    return user_out(u)


@app.post("/api/admin/members/{mid}/reset-password")
def reset_password(mid: int, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    u = get_member(db, mid)
    pw = default_password()
    u.password_hash, u.must_change_password = hash_pw(pw), True
    db.commit()
    return {"member": user_out(u), "default_password": pw}


@app.delete("/api/admin/members/{mid}")
def delete_member(mid: int, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    u = get_member(db, mid)
    db.query(Attendance).filter_by(user_id=u.id).delete()
    db.delete(u)
    db.commit()
    return {"ok": True}


@app.get("/api/admin/attendance")
def attendance(limit: int = Query(100, le=500), _: User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = (db.query(Attendance, User).join(User, User.id == Attendance.user_id)
            .order_by(Attendance.check_in.desc()).limit(limit).all())
    out = []
    for a, u in rows:
        end = a.check_out
        out.append({"id": a.id, "name": u.name, "username": u.username, "check_in": iso(a.check_in),
                    "check_out": iso(end), "auto_closed": bool(a.auto_closed),
                    "minutes": round(((end or now()) - a.check_in).total_seconds() / 60) if not a.auto_closed else 0})
    return out


@app.get("/api/admin/unregistered")
def unregistered(_: User = Depends(admin_only), db: Session = Depends(get_db)):
    cutoff = now() - timedelta(hours=24)
    rows = (db.query(UnregisteredScan).filter(UnregisteredScan.last_seen >= cutoff)
            .order_by(UnregisteredScan.last_seen.desc()).limit(10).all())
    return [{"uid": r.uid, "last_seen": iso(r.last_seen), "count": r.count} for r in rows]
