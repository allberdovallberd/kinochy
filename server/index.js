import './env.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import {
  addVocabulary,
  addFavoriteMovie,
  createAdminUser,
  createUser,
  createMovie,
  deleteAdminUsers,
  deleteMovie,
  findVocabularyEntry,
  isFavoriteMovie,
  getAdminUser,
  getClientMovieById,
  getMovie,
  getMovieById,
  getSubtitles,
  hasDatabase,
  initDatabase,
  listAdminUsers,
  listGenres,
  listFavoriteMovieIds,
  listFavoriteMovies,
  listVocabulary,
  getUserByIdentity,
  listMovies,
  queueMovieVideoOptimization,
  removeVocabulary,
  removeFavoriteMovie,
  resetUserPassword,
  resendVerification,
  startPasswordReset,
  updateAdminUser,
  updateMovie,
  updateUserLanguage,
  verifyAdmin,
  verifyPasswordResetCode,
  verifyUserEmail,
  verifyUser
} from './db.js';
import { sendVerificationEmail } from './email.js';
import { translateText } from './translate.js';

globalThis.crypto ??= crypto.webcrypto;

const app = express();
const port = Number(process.env.PORT || 4000);
const jwtSecret = process.env.JWT_SECRET || 'development-secret';
const uploadRoot = path.resolve('storage/uploads');
const distRoot = path.resolve('dist');
const assetRoot = path.join(distRoot, 'assets');
const indexFile = path.join(distRoot, 'index.html');
const appBasePath = normalizeBasePath(process.env.APP_BASE_PATH || process.env.BASE_PATH || '');
const adminCookieName = 'kinochy_admin';
const userCookieName = 'kinochy_user';
const legacyAdminCookieName = 'filmglish_admin';
const legacyUserCookieName = 'filmglish_user';
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure =
  process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && isProduction);
const allowedOrigins = new Set(
  String(process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

fs.mkdirSync(uploadRoot, { recursive: true });
if (process.env.TRUST_PROXY === 'true' || isProduction) app.set('trust proxy', 1);

if (appBasePath) {
  app.use((req, res, next) => {
    if (req.url === appBasePath) return res.redirect(308, `${appBasePath}/`);
    if (req.url.startsWith(`${appBasePath}/`)) {
      req.url = req.url.slice(appBasePath.length) || '/';
    }
    next();
  });
}

const uploadMaxBytes = Number(process.env.UPLOAD_MAX_BYTES || 8 * 1024 * 1024 * 1024);
const initialMediaChunkBytes = Number(process.env.MEDIA_INITIAL_CHUNK_BYTES || 0);
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename: (_req, file, done) => {
      const extension = path.extname(file.originalname);
      done(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: {
    fileSize: uploadMaxBytes
  }
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true
  })
);
app.use(compression({ threshold: 1024 }));
app.use(express.json());
app.use(cookieParser());
app.use(
  '/media/uploads',
  express.static(uploadRoot, {
    maxAge: '7d',
    immutable: false
  })
);

await initDatabase().catch((error) => {
  console.warn('[kinochy] PostgreSQL unavailable, using local data:', error.message);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: hasDatabase() ? 'postgres' : 'local-json' });
});

app.get('/api/movies', async (req, res, next) => {
  try {
    res.json(await listMovies(String(req.query.search || '')));
  } catch (error) {
    next(error);
  }
});

app.get('/api/genres', async (_req, res, next) => {
  try {
    res.json(await listGenres());
  } catch (error) {
    next(error);
  }
});

app.get('/api/movies/:slug', async (req, res, next) => {
  try {
    const movie = await getMovie(req.params.slug);
    if (!movie) return res.status(404).json({ message: 'Movie not found' });
    res.json(movie);
  } catch (error) {
    next(error);
  }
});

app.get('/api/movies/:slug/subtitles/:language', async (req, res, next) => {
  try {
    const movie = await getMovie(req.params.slug);
    if (!movie) return res.status(404).json({ message: 'Movie not found' });
    res.json(await getSubtitles(movie.id, req.params.language));
  } catch (error) {
    next(error);
  }
});

app.get('/api/translate', async (req, res, next) => {
  try {
    res.json(
      await translateText({
        text: req.query.text,
        from: req.query.from || 'en',
        to: req.query.to || 'ru'
      })
    );
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const admin = await verifyAdmin(req.body.email, req.body.password);
    if (!admin) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign(admin, jwtSecret, { expiresIn: '8h' });
    res.cookie(adminCookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      maxAge: 8 * 60 * 60 * 1000
    });
    res.json({ admin });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(adminCookieName);
  res.clearCookie(legacyAdminCookieName);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  try {
    const token = req.cookies[adminCookieName] || req.cookies[legacyAdminCookieName];
    if (!token) return res.json({ admin: null });
    const admin = jwt.verify(token, jwtSecret);
    res.json({ admin });
  } catch {
    res.json({ admin: null });
  }
});

app.post('/api/users/signup', async (req, res, next) => {
  try {
    const pending = await createUser(req.body);
    await sendVerificationEmail({ email: pending.email, username: pending.username, code: pending.verificationCode });
    res.status(201).json({ pending: serializePending(pending) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/verify-email', async (req, res, next) => {
  try {
    const user = await verifyUserEmail(req.body.email, req.body.code);
    setUserCookie(res, user);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/resend-verification', async (req, res, next) => {
  try {
    const pending = await resendVerification(req.body.email);
    await sendVerificationEmail({ email: pending.email, username: pending.username, code: pending.verificationCode });
    res.json({ pending: serializePending(pending) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/forgot-password', async (req, res, next) => {
  try {
    const pending = await startPasswordReset(req.body.email);
    await sendVerificationEmail({ email: pending.email, username: pending.username, code: pending.verificationCode });
    res.json({ pending: serializePending(pending) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/verify-password-reset', async (req, res, next) => {
  try {
    res.json(await verifyPasswordResetCode(req.body.email, req.body.code));
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/reset-password', async (req, res, next) => {
  try {
    res.json(await resetUserPassword(req.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/login', async (req, res, next) => {
  try {
    const user = await verifyUser(req.body.email, req.body.password);
    setUserCookie(res, user);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/logout', (_req, res) => {
  clearUserCookies(res);
  res.json({ ok: true });
});

app.get('/api/users/me', async (req, res) => {
  try {
    const token = req.cookies[userCookieName] || req.cookies[legacyUserCookieName];
    if (!token) return res.json({ user: null });
    const decoded = jwt.verify(token, jwtSecret);
    const user = await getUserByIdentity(decoded);
    if (!user) {
      clearUserCookies(res);
      return res.json({ user: null });
    }
    setUserCookie(res, user);
    res.json({ user });
  } catch {
    clearUserCookies(res);
    res.json({ user: null });
  }
});

app.patch('/api/users/language', async (req, res, next) => {
  try {
    const token = req.cookies[userCookieName] || req.cookies[legacyUserCookieName];
    if (!token) return res.status(401).json({ message: 'Login required' });
    const decoded = jwt.verify(token, jwtSecret);
    const current = await getUserByIdentity(decoded);
    if (!current) {
      clearUserCookies(res);
      return res.status(401).json({ message: 'Login required' });
    }
    const user = await updateUserLanguage(current.id, req.body.language);
    setUserCookie(res, user);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/vocabulary', requireUser, async (req, res, next) => {
  try {
    res.json(await listVocabulary(req.user.id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/vocabulary/check', requireUser, async (req, res, next) => {
  try {
    const entry = await findVocabularyEntry(req.user.id, {
      word: req.query.word,
      sourceLanguage: req.query.sourceLanguage,
      targetLanguage: req.query.targetLanguage
    });
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/vocabulary', requireUser, async (req, res, next) => {
  try {
    res.status(201).json(await addVocabulary(req.user.id, req.body));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/users/vocabulary/:id', requireUser, async (req, res, next) => {
  try {
    const removed = await removeVocabulary(req.user.id, req.params.id);
    if (!removed) return res.status(404).json({ message: 'Word not found' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/favorites', requireUser, async (req, res, next) => {
  try {
    res.json(await listFavoriteMovies(req.user.id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/favorites/ids', requireUser, async (req, res, next) => {
  try {
    res.json(await listFavoriteMovieIds(req.user.id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/favorites/:movieId', requireUser, async (req, res, next) => {
  try {
    res.json({ favorite: await isFavoriteMovie(req.user.id, req.params.movieId) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/favorites/:movieId', requireUser, async (req, res, next) => {
  try {
    res.status(201).json(await addFavoriteMovie(req.user.id, req.params.movieId));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/users/favorites/:movieId', requireUser, async (req, res, next) => {
  try {
    res.json(await removeFavoriteMovie(req.user.id, req.params.movieId));
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await listAdminUsers());
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const user = await getAdminUser(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users', requireAdmin, async (req, res, next) => {
  try {
    res.status(201).json(await createAdminUser(req.body));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    res.json(await updateAdminUser(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/users', requireAdmin, async (req, res, next) => {
  try {
    res.json(await deleteAdminUsers(req.body.ids));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    res.json(await deleteAdminUsers([req.params.id]));
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/movies/:id', requireAdmin, async (req, res, next) => {
  try {
    const movie = await getClientMovieById(req.params.id);
    if (!movie) return res.status(404).json({ message: 'Movie not found' });
    res.json(movie);
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/admin/movies',
  requireAdmin,
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
    { name: 'subtitleEn', maxCount: 1 },
    { name: 'subtitleRu', maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      const movie = await createMovie(req.body, req.files || {});
      queueMovieVideoOptimization(movie.id);
      res.status(201).json(movie);
    } catch (error) {
      next(error);
    }
  }
);

app.patch(
  '/api/admin/movies/:id',
  requireAdmin,
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
    { name: 'subtitleEn', maxCount: 1 },
    { name: 'subtitleRu', maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      const movie = await updateMovie(req.params.id, req.body, req.files || {});
      if (req.files?.video?.[0]) queueMovieVideoOptimization(movie.id);
      res.json(movie);
    } catch (error) {
      next(error);
    }
  }
);

app.delete('/api/admin/movies/:id', requireAdmin, async (req, res, next) => {
  try {
    res.json(await deleteMovie(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.get('/media/movies/:id/playlist.m3u8', async (req, res, next) => {
  try {
    const movie = await getMovieById(req.params.id);
    if (!movie) return res.status(404).end();
    const cues = await getSubtitles(movie.id, 'en');
    res.type('application/vnd.apple.mpegurl').send(createByteRangePlaylist(movie, cues));
  } catch (error) {
    next(error);
  }
});

app.get('/media/movies/:id/segment.ts', async (req, res, next) => {
  try {
    const movie = await getMovieById(req.params.id);
    if (!movie) return res.status(404).end();
    streamFile(req, res, movie.videoPath, 'video/mp2t');
  } catch (error) {
    next(error);
  }
});

app.get('/media/movies/:id/video', async (req, res, next) => {
  try {
    const movie = await getMovieById(req.params.id);
    if (!movie) return res.status(404).end();
    streamFile(req, res, movie.videoPath, detectVideoContentType(movie.videoPath));
  } catch (error) {
    next(error);
  }
});

if (fs.existsSync(indexFile)) {
  if (fs.existsSync(assetRoot)) {
    app.use(
      '/assets',
      express.static(assetRoot, {
        fallthrough: false,
        immutable: true,
        maxAge: '1y'
      })
    );
  }
  app.use(
    express.static(distRoot, {
      index: false,
      maxAge: '1h'
    })
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
    if (path.extname(req.path)) return res.status(404).end();
    res.sendFile(indexFile);
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Uploaded file is too large.' });
  }
  res.status(error.status || 500).json({ message: error.message || 'Server error', code: error.code, email: error.email });
});

const server = app.listen(port, () => {
  console.log(`[kinochy] API listening on http://localhost:${port}`);
});
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 0);
server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 600000);
server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65000);

function requireAdmin(req, res, next) {
  try {
    const token = req.cookies[adminCookieName] || req.cookies[legacyAdminCookieName];
    if (!token) return res.status(401).json({ message: 'Login required' });
    req.admin = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ message: 'Login required' });
  }
}

async function requireUser(req, res, next) {
  try {
    const token = req.cookies[userCookieName] || req.cookies[legacyUserCookieName];
    if (!token) return res.status(401).json({ message: 'Login required' });
    const decoded = jwt.verify(token, jwtSecret);
    const user = await getUserByIdentity(decoded);
    if (!user) {
      clearUserCookies(res);
      return res.status(401).json({ message: 'Login required' });
    }
    req.user = user;
    next();
  } catch {
    clearUserCookies(res);
    res.status(401).json({ message: 'Login required' });
  }
}

function setUserCookie(res, user) {
  const token = jwt.sign(user, jwtSecret, { expiresIn: '30d' });
  res.cookie(userCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearUserCookies(res) {
  res.clearCookie(userCookieName);
  res.clearCookie(legacyUserCookieName);
}

function streamFile(req, res, filePath, contentType) {
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ message: 'Video file not found' });

  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  const modified = stat.mtime.toUTCString();
  const etag = `"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=604800, immutable',
    'Content-Disposition': 'inline',
    'Last-Modified': modified,
    ETag: etag
  };

  if (!range && (req.headers['if-none-match'] === etag || req.headers['if-modified-since'] === modified)) {
    res.writeHead(304, baseHeaders);
    return res.end();
  }

  if (!range && req.method === 'HEAD') {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
    return res.end();
  }

  if (!range) {
    if (req.method === 'GET' && contentType.startsWith('video/') && initialMediaChunkBytes > 0 && stat.size > initialMediaChunkBytes) {
      const end = Math.min(initialMediaChunkBytes - 1, stat.size - 1);
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes 0-${end}/${stat.size}`,
        'Content-Length': end + 1
      });
      return fs.createReadStream(filePath, { start: 0, end, highWaterMark: 256 * 1024 }).pipe(res);
    }
    res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
    return fs.createReadStream(filePath, { highWaterMark: 512 * 1024 }).pipe(res);
  }

  const [startText, endText] = range.replace(/bytes=/, '').split('-');
  let start = startText ? Number(startText) : 0;
  let end = endText ? Number(endText) : stat.size - 1;
  if (!startText && endText) {
    const suffixLength = Number(endText);
    start = Math.max(0, stat.size - suffixLength);
    end = stat.size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
    return res.end();
  }
  end = Math.min(end, stat.size - 1);
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    ...baseHeaders,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Content-Length': chunkSize
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath, { start, end, highWaterMark: 256 * 1024 }).pipe(res);
}

function detectVideoContentType(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.m3u8') return 'application/vnd.apple.mpegurl';
  if (ext === '.ts') return 'video/mp2t';
  return 'application/octet-stream';
}

function createByteRangePlaylist(movie, cues = []) {
  const stat = fs.statSync(movie.videoPath);
  const duration = Math.max(1, Math.ceil(cues.at(-1)?.end || 7200));
  const targetDuration = 2;
  const segmentCount = Math.max(1, Math.ceil(duration / targetDuration));
  const packetSize = 188;
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD'
  ];

  let offset = 0;
  for (let index = 0; index < segmentCount && offset < stat.size; index += 1) {
    const remainingBytes = stat.size - offset;
    const remainingSegments = segmentCount - index;
    let length = Math.ceil(remainingBytes / remainingSegments);
    if (remainingSegments > 1) length = Math.max(packetSize, Math.floor(length / packetSize) * packetSize);
    length = Math.min(length, remainingBytes);
    const seconds = index === segmentCount - 1 ? Math.max(1, duration - targetDuration * index) : targetDuration;
    lines.push(`#EXTINF:${seconds.toFixed(3)},`);
    lines.push(`#EXT-X-BYTERANGE:${length}@${offset}`);
    lines.push('segment.ts');
    offset += length;
  }

  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

function serializePending(pending) {
  return {
    email: pending.email,
    username: pending.username,
    verificationExpiresAt: pending.verificationExpiresAt
  };
}

function isAllowedOrigin(origin) {
  if (allowedOrigins.has(origin)) return true;

  try {
    const url = new URL(origin);
    const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    const isPrivateIpv4 =
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
    const appPort = String(port);
    const vitePort = '5173';

    if ((isLoopback || isPrivateIpv4) && [appPort, vitePort].includes(url.port)) return true;
  } catch {
    return false;
  }

  return false;
}

function normalizeBasePath(value) {
  const clean = String(value || '').trim();
  if (!clean || clean === '/') return '';
  return `/${clean.replace(/^\/+|\/+$/g, '')}`;
}
