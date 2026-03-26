# PreciMap API v3.1.0

Backend de PreciMap — Node.js + Express + Supabase

## Variables de entorno requeridas

Crea un archivo `.env` basado en `.env.example`:

```
PORT=3000
JWT_SECRET=<secreto_aleatorio_largo>
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_KEY=sb_secret_...
AMAZON_AFFILIATE_TAG=tu-tag-21
```

## Arrancar en local

```bash
npm install
node server.js
# Escucha en http://localhost:3000
```

## Despliegue en Railway

1. Conecta el repositorio en railway.app
2. Añade las variables de entorno en el dashboard
3. Railway despliega automáticamente con `railway.toml`

## Despliegue en Render

1. New Web Service → conecta el repo
2. Build Command: `npm install`
3. Start Command: `node server.js`
4. Añade variables de entorno

## Base de datos

Supabase — ejecuta `supabase_migration.sql` en el SQL Editor del proyecto.

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/health | Estado del servidor |
| POST | /api/auth/register | Registro |
| POST | /api/auth/login | Login |
| GET | /api/gasolineras | Gasolineras (caché 10min) |
| GET | /api/places | Lugares con precios |
| GET | /api/deals | Chollos |
| GET | /api/leaderboard | Ranking |
| GET | /api/events | Eventos |
| GET | /api/banks | Ofertas bancarias |
| GET | /api/supermarkets/ranking | Ranking supermercados OCU |
