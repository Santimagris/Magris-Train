# Registro de Entrenamiento — Santino & Gino

App web (mobile-first) para registrar entrenamientos y peso corporal, con exportación a Excel.
Stack: **Node.js + Express + PostgreSQL**. Pensada para desplegar en **Railway**.

## Qué hace
- Dos usuarios (Santino y Gino), cada uno con sus propios registros.
- Registrar peso y reps de cada serie de cada ejercicio (fecha y hora automáticas).
- Registrar el peso corporal en el tiempo (fecha automática).
- Historial completo y borrado de registros.
- El plan de entrenamiento y nutrición adentro.
- Exportar un Excel por usuario con **todo**: Resumen, Entrenamientos (todas las series), Progresión por ejercicio y Peso corporal.

---

## Cómo desplegar en Railway (paso a paso)

### 1. Subir el código a GitHub
1. Creá un repo nuevo en GitHub (ej. `gym-tracker`).
2. Desde esta carpeta (`gym-tracker/`), subilo:
   ```bash
   git init
   git add .
   git commit -m "Gym tracker inicial"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/gym-tracker.git
   git push -u origin main
   ```
   > `node_modules/` ya está en `.gitignore`, no se sube (Railway instala solo).

### 2. Crear el proyecto en Railway
1. Entrá a https://railway.app y logueate (con GitHub es lo más fácil).
2. **New Project → Deploy from GitHub repo →** elegí tu repo `gym-tracker`.
3. Railway detecta Node y hace el primer deploy (todavía sin base de datos, va a fallar: normal).

### 3. Agregar la base de datos PostgreSQL
1. Dentro del proyecto: **New → Database → Add PostgreSQL**.
2. Railway crea la base y una variable `DATABASE_URL`.

### 4. Conectar la base al servicio de la app
1. Clic en el servicio de tu app (el del repo) → pestaña **Variables**.
2. Agregá una variable:
   - **Nombre:** `DATABASE_URL`
   - **Valor:** `${{Postgres.DATABASE_URL}}`  *(referencia a la base; si tu servicio de DB se llama distinto, usá ese nombre)*
3. Guardá. Railway hace redeploy solo.

> La app crea las tablas y carga los ejercicios/usuarios sola en el primer arranque.

### 5. Generar el dominio público
1. Servicio de la app → **Settings → Networking → Generate Domain**.
2. Te da una URL tipo `https://gym-tracker-production.up.railway.app`.
3. Abrila en el celular y **agregala a la pantalla de inicio** (compartir → “Agregar a inicio” en iPhone, o menú ⋮ → “Agregar a pantalla principal” en Android). Queda como una app.

Listo. Cada vez que hagas `git push`, Railway redespliega solo.

---

## Variables de entorno
| Variable | Necesaria | Descripción |
|----------|-----------|-------------|
| `DATABASE_URL` | Sí | La inyecta Railway al conectar Postgres. |
| `PORT` | No | La setea Railway sola. |
| `DB_SSL` | No | Poné `true` solo si usás una URL pública de Postgres que exige SSL. Con la interna de Railway no hace falta. |

## Correr local (opcional, necesitás Docker)
```bash
docker run -d --name gt-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gym -p 55432:5432 postgres:16-alpine
# PowerShell:
$env:DATABASE_URL="postgresql://postgres:test@localhost:55432/gym"; npm install; npm start
```
Abrí http://localhost:3000
