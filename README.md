# Kinochy

Kinochy is a movie-based English learning platform with streaming playback, interactive subtitles, word translation, vocabulary saving, user authentication, and an admin panel for managing movies and subtitle files.

## Stack

- Frontend: React 19 + Vite
- Backend: Node.js + Express
- Database: PostgreSQL
- Video tools: HLS.js on the client, FFmpeg in the app container
- Email verification: Brevo

## Features

- Movie, series, animation, favorites, and vocabulary pages
- Interactive English and Russian subtitles
- Real-time subtitle overlay plus paused subtitle script
- Word lookup with translation and pronunciation
- User signup, login, password reset, and language preferences
- Admin module for movie upload, editing, deletion, and user management

## Project Structure

- `src/`: React frontend
- `server/`: Express API, auth, email, translation, media routes
- `database/`: PostgreSQL schema and seed data
- `public/`: static assets such as icons and logos
- `storage/`: uploaded files and runtime data
- `docker-compose.yml`: production-style Docker deployment
- `Dockerfile`: application image build

## Local Development Without Docker

1. Install dependencies:

```bash
npm ci
```

2. Create `.env` from `.env.example` and fill in the values you need.

3. Start frontend and backend together:

```bash
npm run dev
```

4. Open:

- `http://localhost:5173` for Vite dev mode
- `http://localhost:4000/api/health` for backend health

## Docker Deployment

The repo is prepared so the app can build from a clean clone on a server.

1. Clone the repository on the server:

```bash
git clone https://github.com/allberdovallberd/kinochy.git
cd kinochy
```

2. Create `.env` on the server:

```bash
cp .env.example .env
```

3. Edit `.env` and set at least these values:

- `CLIENT_ORIGIN=http://YOUR_DOMAIN_OR_IP:4000`
- `JWT_SECRET=your-long-random-secret`
- `POSTGRES_DB=kinochy`
- `POSTGRES_USER=kinochy`
- `POSTGRES_PASSWORD=strong-db-password`
- `ADMIN_EMAIL=admin@your-domain.com`
- `ADMIN_USER_NAME=Admin`
- `ADMIN_PASSWORD=strong-admin-password`
- `BREVO_API_KEY=your-brevo-api-key`
- `BREVO_API_URL=https://api.brevo.com/v3/smtp/email`
- `BREVO_IP_FAMILY=4`
- `BREVO_SENDER_NAME=Allberdov Allberd`
- `BREVO_SENDER_EMAIL=allberdovallberd@gmail.com`

4. Build and start:

```bash
docker compose up -d --build
```

5. Check status:

```bash
docker compose ps
docker compose logs -f app
```

6. Open:

- `http://YOUR_DOMAIN_OR_IP:4000`

## Persistent Data

Docker volumes keep production data between restarts:

- `postgres_data`: PostgreSQL database files
- `app_storage`: uploaded videos, covers, subtitles, and runtime storage

Uploaded movie assets are stored inside the app volume under `/app/storage/uploads`.

## Environment Variables

The runtime reads `.env` from the project root.

Important variables:

- `PORT`: internal Node port, normally `4000`
- `APP_PORT`: host port exposed by Docker Compose
- `APP_BASE_PATH`: public mount path for subpath deployments, for example `/kinochy`
- `CLIENT_ORIGIN`: allowed browser origin for CORS
- `JWT_SECRET`: JWT signing secret
- `UPLOAD_MAX_BYTES`: maximum size for each uploaded file, default `8589934592` bytes
- `REQUEST_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS`, `KEEP_ALIVE_TIMEOUT_MS`: Node HTTP timeout settings for large uploads
- `MEDIA_INITIAL_CHUNK_BYTES`: optional first partial video response size when a client does not send a byte range, default `0` disabled
- `VIDEO_OPTIMIZE_ON_UPLOAD`: set to `true` only if uploads should wait for FFmpeg optimization before responding
- `VIDEO_BACKGROUND_OPTIMIZE`: set to `false` to disable automatic background conversion of uploaded videos to stream-ready MP4
- `DATABASE_URL`: optional direct PostgreSQL connection string for non-Docker runs
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: PostgreSQL container settings
- `NODE_IMAGE`, `POSTGRES_IMAGE`: container image overrides if needed
- `ADMIN_EMAIL`, `ADMIN_USER_NAME`, `ADMIN_PASSWORD`: initial admin account
- `DEFAULT_USER_NAME`, `DEFAULT_USER_EMAIL`, `DEFAULT_USER_PASSWORD`: default seeded user
- `TRANSLATE_PROVIDER`, `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY`: translation service config
- `BREVO_API_KEY` or `BREVO_SMTP_KEY`: verification email provider config
- `BREVO_API_URL`, `BREVO_API_URLS`, `BREVO_TIMEOUT_MS`, `BREVO_IP_FAMILY`: Brevo API endpoint fallback list, timeout, and IP family. Keep `BREVO_IP_FAMILY=4` on servers where IPv6 or Cloudflare routes time out.
- `BREVO_SMTP_KEY`, `BREVO_SMTP_PASSWORD`, or `SMTP_PASSWORD`: Brevo SMTP key aliases used when API delivery times out or SMTP is preferred

## Production Notes

- `.env` is intentionally ignored by git and should not be committed.
- Use a reverse proxy such as Nginx if you want HTTPS and a domain.
- Set `COOKIE_SECURE=true` when serving behind HTTPS.
- Set `TRUST_PROXY=true` when running behind Nginx, Caddy, Traefik, or another proxy.
- Run backups for both Docker volumes if the server will host real user data.

## Useful Commands

```bash
npm run build
npm run db:init
npm run db:seed
npm run videos:optimize
docker compose down
docker compose up -d --build
docker compose logs -f app
docker compose logs -f postgres
```

## Troubleshooting

- If signup email fails, verify that Brevo transactional sending is enabled and the sender is approved. If the error says Brevo is unreachable, test outbound HTTPS from the server and keep `BREVO_IP_FAMILY=4`.
- If Docker cannot pull images, try again or override `NODE_IMAGE` and `POSTGRES_IMAGE` in `.env`.
- If the browser gets CORS errors, make sure `CLIENT_ORIGIN` exactly matches the URL you open in the browser.
- If large movie uploads reset near the end, keep `VIDEO_OPTIMIZE_ON_UPLOAD=false`, rebuild the app image, and optimize videos later with `npm run videos:optimize`.
- If an uploaded movie starts and then buffers forever, run `npm run videos:optimize` or `docker compose exec app npm run videos:optimize` so existing videos are converted to stream-ready MP4. New uploads are optimized in the background unless `VIDEO_BACKGROUND_OPTIMIZE=false`.
- After deploying an updated image, run `docker compose exec app npm run videos:optimize` once for old uploads. This does not add fixed duration rules; it moves MP4 metadata to the front when possible and transcodes unsupported files to browser-friendly H.264/AAC MP4.
- If media uploads work but playback fails, check `docker compose logs -f app` and verify uploaded files exist in `app_storage`.
