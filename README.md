# IronGate Gym — RFID membership system

React (Vercel) + FastAPI (Render) + Arduino Uno (RC522, I2C LCD, SD module).

```
 RFID card ─► Arduino ──USB cable──► Gym PC (Chrome/Edge on /kiosk) ──HTTPS──► FastAPI on Render ─► Postgres
                ▲  LCD text + SD log  ◄──────────────┘
```

* The scanner is read **by the browser** (Web Serial). Keep one PC at the gym with the Arduino plugged in and
  `https://YOUR-APP.vercel.app/kiosk` open in Chrome/Edge. The kiosk page sends each tap to the API and writes the
  result (name, days left, IN/OUT time) back to the **LCD** through the same cable.
* Tap once = check in, tap again = check out. Hours are calculated from the pair. Forgotten tap-outs (>12 h) are closed automatically.
* Expired or banned cards are refused and shown on the LCD + screen. Unknown cards show "CARD NOT REGISTERED".

## Pages
| URL | Who | What |
|---|---|---|
| `/` | everyone | username + password login |
| `/kiosk` | gym PC | scanner screen, LCD feedback, SD status |
| `/admin` | admin | overview + storage bar, register / renew / ban / delete members, reset password, attendance log |
| `/member` | member | days left, hours this week/month, 14-day chart, recent sessions (read-only) + change password |

**Registering a member:** open *Members → Register member*, type the name, then either **tap the card on the kiosk** (auto-detected) or **type the card number**, choose months paid → the app shows a **default username and password** once. The member must change the
password on first login. *Reset pw* issues a new default password.

## Card security (anti-cloning)
A card's UID is not secret and can be copied by phone apps or "magic" cards, so the UID alone is never trusted after setup:
1. Registering a member creates a random **secret code** for that member (stored only on the server and on the card).
2. The **first tap** on the kiosk writes the secret into the card (sector 1, locked with `SECRET_KEY` from the sketch). The screen says "Card secured" — tap again to check in. Admin → Members shows **secured / not secured** per card.
3. From then on every tap must present UID **and** secret. A copied UID without the secret shows "Invalid card".
* Existing members (created before this update) are secured automatically on their next tap. Do the first tap yourself when you hand over a card.
* Card numbers are masked in the app (only the last 2 bytes are visible); members cannot edit anything, and a card can belong to one member only.
* Limits: this needs **MIFARE Classic 1K/4K** cards (the usual blue/white RC522 cards). Classic encryption is old, so a determined attacker with special tools could still recover a key; for high security use DESFire/NTAG424 cards with a PN532 reader. Never change or leak `SECRET_KEY`.
* Test box on the kiosk ("Simulate scan") sends no secret, so it cannot impersonate a secured card.

## SD card (important to read)
Render cannot reach an SD card that is plugged into your Arduino, so the SD card works as an **offline backup log** (`LOG.CSV`,
one line per tap), while the main database is Postgres on the server. The Arduino reports used/total size → the admin
**Storage bar** (green → orange at 85% → red at 98%). When it is full, swap the card and press **"I replaced the SD card"** on the kiosk page.
`SD_LIMIT_KB` in the sketch lets you cap the size (e.g. 2048) to test the full/swap flow. A normal card will take years to fill with these logs.

## Deploy
**Backend (Render → New Web Service, root dir `backend`)**
* Build: `pip install -r requirements.txt`   Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
* Env vars (see `backend/.env.example`): `SECRET_KEY`, `KIOSK_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `FRONTEND_ORIGIN` (your Vercel URL), `DATABASE_URL`.
* Use a Postgres `DATABASE_URL` (Render Postgres, Neon, Supabase…). Without it the app falls back to a local SQLite file that is **erased on every redeploy**.
* If `ADMIN_PASSWORD` is not set the admin is `admin` / `admin123` and must change it at first login.

**Frontend (Vercel → root dir `frontend`, framework Vite)**
* Env var: `VITE_API_URL=https://YOUR-BACKEND.onrender.com`

**Arduino:** install libraries *MFRC522* and *LiquidCrystal_I2C*, upload `arduino/RFID_Membership/RFID_Membership.ino`, close the Serial Monitor.
Wiring is in the sketch header (SD module: CS→D4, SCK/MOSI/MISO shared with the RC522).

**First run:** open `/kiosk` → *Connect scanner* → pick the Arduino port → enter the same `KIOSK_KEY` → done (it reconnects automatically next time).

## Notes
* Render's free plan sleeps when idle, so the first tap after a quiet period can take ~1 min; use a paid instance for a front-desk system.
* RFID UIDs can be cloned; this is fine for a gym but not for high-security access.
* Local dev: `cd backend && pip install -r requirements.txt && KIOSK_KEY=test uvicorn main:app --reload` and `cd frontend && npm i && npm run dev`.
