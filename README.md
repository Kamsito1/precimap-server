# 💰 MapaTacaño — Server

> Backend API para MapaTacaño. Node.js + Express + Supabase.

## 🌐 Production

- **URL:** https://web-production-a8023.up.railway.app
- **Health:** https://web-production-a8023.up.railway.app/api/health
- **Version:** v4.0.0

## 📡 API Endpoints

### Public
- `GET /api/health` — Server status
- `GET /api/version` — Version info
- `GET /api/gasolineras/stats` — Gas price stats (G95, Diesel, G98, GLP)
- `GET /api/gasolineras?lat=X&lng=Y&radius=30` — Nearby gas stations
- `GET /api/deals?sort=hot&limit=20` — Deals list
- `GET /api/places?cat=restaurante&city=Córdoba` — Places
- `GET /api/events?cat=all&city=Córdoba` — Events

### Authenticated
- `POST /api/deals` — Create deal (multipart, image upload)
- `POST /api/deals/:id/images` — Add images to deal
- `POST /api/deals/:id/vote` — Vote on deal
- `POST /api/deals/:id/report-scam` — Report timo
- `POST /api/events` — Create event (multipart, image upload)
- `PATCH /api/users/me` — Update profile

## 🧪 Testing
```bash
bash test_api.sh
```

## 🛡️ Security
- Helmet (security headers)
- Rate limiting
- CORS configured
- Supabase parameterized queries (no SQL injection)
- JWT auth with bcrypt passwords
