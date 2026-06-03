import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { parseSrt } from './srt.js';
import { optimizeExistingVideoPath, prepareUploadedVideo } from './video.js';

const localStorePath = path.resolve('storage/data.json');
const localUsersPath = path.resolve('storage/users.json');
const localAdminsPath = path.resolve('storage/admins.json');
const legacySampleSlug = 'war-machine-2026';
const defaultGenres = [
  'Action',
  'Adventure',
  'Animation',
  'Biography',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'Film-Noir',
  'History',
  'Horror',
  'Musical',
  'Mystery',
  'Reality',
  'Romance',
  'Sci-Fi',
  'Sport',
  'Thriller',
  'War',
  'Western'
];
const defaultUser = {
  username: process.env.DEFAULT_USER_NAME || 'Allberdov',
  email: (process.env.DEFAULT_USER_EMAIL || 'allberdov@gmail.com').toLowerCase(),
  password: process.env.DEFAULT_USER_PASSWORD || 'Kinochy@4321!',
  role: 'user'
};
const adminAccount = {
  username: process.env.ADMIN_USER_NAME || 'Admin',
  email: (process.env.ADMIN_EMAIL || 'allberdov@gmail.com').toLowerCase(),
  password: process.env.ADMIN_PASSWORD || 'Kinochy@4321!',
  role: 'admin'
};
const defaultLanguage = 'tm';

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL
    })
  : null;

export function hasDatabase() {
  return Boolean(pool);
}

export async function initDatabase() {
  if (!pool) {
    await ensureLocalStore();
    await ensureLocalAdminsSeed();
    await ensureLocalUsersSeed();
    return;
  }
  const schema = await fs.readFile(path.resolve('database/schema.sql'), 'utf8');
  await pool.query(schema);
  await ensureAdmin();
  await ensureSeedUsersInDatabase();
  await ensureDefaultGenresInDatabase();
  await pool.query('DELETE FROM movies WHERE slug = $1', [legacySampleSlug]);
}

async function ensureAdmin() {
  const email = adminAccount.email;
  const password = adminAccount.password;
  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `INSERT INTO admins (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [email, passwordHash]
  );
}

export async function verifyAdmin(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!pool) {
    const store = await readLocalAdmins();
    const admin = store.admins.find((item) => item.email === cleanEmail);
    if (admin) {
      const valid = await bcrypt.compare(String(password || ''), admin.passwordHash);
      if (valid) return { id: admin.id, email: admin.email };
    }
    const users = await readLocalUsers();
    const userAdmin = users.users.find((item) => item.email === cleanEmail && item.verified && normalizeRole(item.role) === 'admin');
    if (!userAdmin) return null;
    const validUserAdmin = await bcrypt.compare(String(password || ''), userAdmin.passwordHash);
    return validUserAdmin ? { id: userAdmin.id, email: userAdmin.email } : null;
  }

  const result = await pool.query('SELECT id, email, password_hash FROM admins WHERE email = $1', [cleanEmail]);
  const admin = result.rows[0];
  if (admin) {
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (valid) return { id: admin.id, email: admin.email };
  }

  const userResult = await pool.query(
    'SELECT id, email, password_hash FROM users WHERE email = $1 AND verified = true AND role = $2',
    [cleanEmail, 'admin']
  );
  const userAdmin = userResult.rows[0];
  if (!userAdmin) return null;
  const validUserAdmin = await bcrypt.compare(password, userAdmin.password_hash);
  return validUserAdmin ? { id: userAdmin.id, email: userAdmin.email } : null;
}

export async function listAdminUsers() {
  if (!pool) {
    const store = await readLocalUsers();
    return store.users.filter((user) => user.verified && !isDemoEmail(user.email)).map(toAdminUser);
  }

  const result = await pool.query(
    `SELECT id, username, email, role, language, verified, created_at AS "createdAt"
     FROM users
     WHERE verified = true AND email NOT ILIKE $1
     ORDER BY created_at DESC`
    , ['%@example.com']
  );
  return result.rows;
}

export async function getAdminUser(userId) {
  if (!pool) {
    const store = await readLocalUsers();
    const user = store.users.find((item) => item.id === userId && item.verified && !isDemoEmail(item.email));
    return user ? toAdminUser(user) : null;
  }

  const result = await pool.query(
    `SELECT id, username, email, role, language, verified, created_at AS "createdAt"
     FROM users
     WHERE id = $1 AND verified = true AND email NOT ILIKE $2`,
    [userId, '%@example.com']
  );
  return result.rows[0] || null;
}

export async function createAdminUser(payload) {
  const cleanUsername = String(payload.username || '').trim();
  const cleanEmail = String(payload.email || '').trim().toLowerCase();
  const cleanPassword = String(payload.password || '');
  const role = normalizeRole(payload.role);
  const language = normalizeLanguage(payload.language);
  if (cleanUsername.length < 2) throw userInputError('Username must be at least 2 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw userInputError('Enter a valid email.');
  if (!isStrongPassword(cleanPassword)) throw userInputError('Use a strong password: 8+ chars with uppercase, lowercase, number, and special symbol.');
  const passwordHash = await bcrypt.hash(cleanPassword, 12);

  if (!pool) {
    const store = await readLocalUsers();
    if (store.users.some((user) => user.email === cleanEmail)) throw userInputError('Email is already registered.');
    const user = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      email: cleanEmail,
      role,
      language,
      passwordHash,
      verified: true,
      verificationCode: null,
      verificationExpiresAt: null,
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
    await writeLocalUsers(store);
    return toAdminUser(user);
  }

  try {
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, language, verified, verification_code, verification_expires_at)
       VALUES ($1, $2, $3, $4, $5, true, NULL, NULL)
       RETURNING id, username, email, role, language, verified, created_at AS "createdAt"`,
      [cleanUsername, cleanEmail, passwordHash, role, language]
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') throw userInputError('Email is already registered.');
    throw error;
  }
}

export async function updateAdminUser(userId, payload) {
  const existing = await getAdminUser(userId);
  if (!existing) throw userInputError('User not found.');
  const updates = {
    username: String(payload.username || '').trim(),
    email: String(payload.email || '').trim().toLowerCase(),
    role: normalizeRole(payload.role),
    language: payload.language ? normalizeLanguage(payload.language) : existing.language || defaultLanguage
  };
  if (updates.username.length < 2) throw userInputError('Username must be at least 2 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) throw userInputError('Enter a valid email.');
  const password = String(payload.password || '');
  const passwordHash = password ? await bcrypt.hash(password, 12) : null;

  if (!pool) {
    const store = await readLocalUsers();
    const user = store.users.find((item) => item.id === userId && item.verified);
    if (!user) throw userInputError('User not found.');
    if (store.users.some((item) => item.id !== userId && item.email === updates.email)) throw userInputError('Email is already registered.');
    Object.assign(user, updates);
    if (passwordHash) user.passwordHash = passwordHash;
    await writeLocalUsers(store);
    return toAdminUser(user);
  }

  const result = await pool.query(
    `UPDATE users
     SET username = $2,
         email = $3,
         role = $4,
         language = $5,
         password_hash = COALESCE($6, password_hash)
     WHERE id = $1 AND verified = true
     RETURNING id, username, email, role, language, verified, created_at AS "createdAt"`,
    [userId, updates.username, updates.email, updates.role, updates.language, passwordHash]
  );
  if (!result.rows[0]) throw userInputError('User not found.');
  return result.rows[0];
}

export async function deleteAdminUsers(ids = []) {
  const userIds = Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
  if (!userIds.length) return { deleted: 0 };

  if (!pool) {
    const store = await readLocalUsers();
    const before = store.users.length;
    store.users = store.users.filter((user) => !userIds.includes(user.id));
    await writeLocalUsers(store);
    return { deleted: before - store.users.length };
  }

  const result = await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  return { deleted: result.rowCount };
}

export async function createUser({ username, email, password }) {
  const cleanUsername = String(username || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (cleanUsername.length < 2) throw userInputError('Username must be at least 2 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw userInputError('Enter a valid email.');
  if (!isStrongPassword(cleanPassword)) {
    throw userInputError('Use a strong password: 8+ chars with uppercase, lowercase, number, and special symbol.');
  }

  const passwordHash = await bcrypt.hash(cleanPassword, 12);

  if (!pool) {
    const store = await readLocalUsers();
    const existing = store.users.find((user) => user.email === cleanEmail);
    if (existing?.verified) throw userInputError('Email is already registered.');

    const verificationCode = generateVerificationCode();
    const verificationExpiresAt = getVerificationExpiry();
    const user = {
      id: existing?.id || crypto.randomUUID(),
      username: cleanUsername,
      email: cleanEmail,
      role: 'user',
      language: existing?.language || defaultLanguage,
      passwordHash,
      verified: false,
      verificationCode,
      verificationExpiresAt,
      createdAt: existing?.createdAt || new Date().toISOString()
    };

    if (existing) Object.assign(existing, user);
    else store.users.push(user);
    await writeLocalUsers(store);
    return toPendingVerification(user);
  }

  try {
    const verificationCode = generateVerificationCode();
    const verificationExpiresAt = getVerificationExpiry();
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, verified, verification_code, verification_expires_at)
       VALUES ($1, $2, $3, 'user', false, $4, $5)
       ON CONFLICT (email) DO UPDATE
       SET username = CASE WHEN users.verified THEN users.username ELSE EXCLUDED.username END,
           password_hash = CASE WHEN users.verified THEN users.password_hash ELSE EXCLUDED.password_hash END,
           verification_code = CASE WHEN users.verified THEN users.verification_code ELSE EXCLUDED.verification_code END,
           verification_expires_at = CASE WHEN users.verified THEN users.verification_expires_at ELSE EXCLUDED.verification_expires_at END
       RETURNING id, username, email, language, verified, verification_code, verification_expires_at`,
      [cleanUsername, cleanEmail, passwordHash, verificationCode, verificationExpiresAt]
    );
    if (result.rows[0]?.verified) throw userInputError('Email is already registered.');
    return toPendingVerification(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') throw userInputError('Email is already registered.');
    throw error;
  }
}

export async function verifyUser(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!pool) {
    const store = await readLocalUsers();
    const user = store.users.find((item) => item.email === cleanEmail);
    if (user) {
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw invalidPasswordError();
      if (!user.verified) throw emailNotRegisteredError();
      return { id: user.id, username: user.username || user.email.split('@')[0], email: user.email, language: user.language || defaultLanguage };
    }

    const admins = await readLocalAdmins();
    const admin = admins.admins.find((item) => item.email === cleanEmail);
    if (!admin) throw emailNotRegisteredError();
    const validAdmin = await bcrypt.compare(String(password || ''), admin.passwordHash);
    if (!validAdmin) throw invalidPasswordError();
    return ensureLocalUserForAdmin(admin);
  }

  const result = await pool.query('SELECT id, username, email, password_hash, language, verified FROM users WHERE email = $1', [cleanEmail]);
  const user = result.rows[0];
  if (user) {
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw invalidPasswordError();
    if (!user.verified) throw emailNotRegisteredError();
    return { id: user.id, username: user.username, email: user.email, language: user.language || defaultLanguage };
  }

  const adminResult = await pool.query('SELECT id, email, password_hash FROM admins WHERE email = $1', [cleanEmail]);
  const admin = adminResult.rows[0];
  if (!admin) throw emailNotRegisteredError();
  const validAdmin = await bcrypt.compare(password, admin.password_hash);
  if (!validAdmin) throw invalidPasswordError();
  return ensureDatabaseUserForAdmin(admin);
}

export async function startPasswordReset(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw userInputError('Enter a valid email.');

  if (!pool) {
    const store = await readLocalUsers();
    const user = store.users.find((item) => item.email === cleanEmail && item.verified);
    if (!user) throw emailNotRegisteredError();
    user.verificationCode = generateVerificationCode();
    user.verificationExpiresAt = getVerificationExpiry();
    await writeLocalUsers(store);
    return toPendingVerification(user);
  }

  const result = await pool.query(
    `UPDATE users
     SET verification_code = $2, verification_expires_at = $3
     WHERE email = $1 AND verified = true
     RETURNING username, email, verification_code, verification_expires_at`,
    [cleanEmail, generateVerificationCode(), getVerificationExpiry()]
  );
  if (!result.rows[0]) throw emailNotRegisteredError();
  return toPendingVerification(result.rows[0]);
}

export async function verifyPasswordResetCode(email, code) {
  const user = await findUserByResetCode(email, code);
  return { email: user.email, verificationExpiresAt: user.verificationExpiresAt || user.verification_expires_at };
}

export async function resetUserPassword({ email, code, password }) {
  const cleanPassword = String(password || '');
  if (!isStrongPassword(cleanPassword)) throw userInputError('Use a strong password: 8+ chars with uppercase, lowercase, number, and special symbol.');
  const user = await findUserByResetCode(email, code);
  const passwordHash = await bcrypt.hash(cleanPassword, 12);

  if (!pool) {
    const store = await readLocalUsers();
    const target = store.users.find((item) => item.id === user.id);
    target.passwordHash = passwordHash;
    target.verificationCode = null;
    target.verificationExpiresAt = null;
    await writeLocalUsers(store);
    return { ok: true };
  }

  await pool.query(
    'UPDATE users SET password_hash = $2, verification_code = NULL, verification_expires_at = NULL WHERE id = $1',
    [user.id, passwordHash]
  );
  return { ok: true };
}

export async function verifyUserEmail(email, code) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanCode = String(code || '').trim();
  if (!/^\d{6}$/.test(cleanCode)) throw userInputError('Enter the 6-digit verification code.');

  if (!pool) {
    const store = await readLocalUsers();
    const user = store.users.find((item) => item.email === cleanEmail);
    if (!user) throw emailNotRegisteredError();
    if (user.verified) return toClientUser(user);
    if (!user.verificationCode || !user.verificationExpiresAt || Date.parse(user.verificationExpiresAt) < Date.now()) {
      throw verificationExpiredError(cleanEmail);
    }
    if (String(user.verificationCode) !== cleanCode) throw invalidVerificationCodeError(cleanEmail);
    user.verified = true;
    user.verificationCode = null;
    user.verificationExpiresAt = null;
    await writeLocalUsers(store);
    return toClientUser(user);
  }

  const result = await pool.query(
    `UPDATE users
     SET verified = true, verification_code = NULL, verification_expires_at = NULL
     WHERE email = $1
       AND verified = false
       AND verification_code = $2
       AND verification_expires_at IS NOT NULL
       AND verification_expires_at >= now()
     RETURNING id, username, email, language`,
    [cleanEmail, cleanCode]
  );
  if (result.rows[0]) return result.rows[0];

  const lookup = await pool.query(
    'SELECT id, username, email, language, verified, verification_code, verification_expires_at FROM users WHERE email = $1',
    [cleanEmail]
  );
  const user = lookup.rows[0];
  if (!user) throw emailNotRegisteredError();
  if (user.verified) return { id: user.id, username: user.username, email: user.email, language: user.language || defaultLanguage };
  if (!user.verification_expires_at || new Date(user.verification_expires_at).getTime() < Date.now()) {
    throw verificationExpiredError(cleanEmail);
  }
  throw invalidVerificationCodeError(cleanEmail);
}

export async function resendVerification(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!pool) {
    const store = await readLocalUsers();
    const user = store.users.find((item) => item.email === cleanEmail);
    if (!user) throw emailNotRegisteredError();
    if (user.verified) throw userInputError('This email is already verified.');
    user.verificationCode = generateVerificationCode();
    user.verificationExpiresAt = getVerificationExpiry();
    await writeLocalUsers(store);
    return toPendingVerification(user);
  }

  const result = await pool.query(
    `UPDATE users
     SET verification_code = $2, verification_expires_at = $3
     WHERE email = $1 AND verified = false
     RETURNING id, username, email, language, verified, verification_code, verification_expires_at`,
    [cleanEmail, generateVerificationCode(), getVerificationExpiry()]
  );
  if (result.rows[0]) return toPendingVerification(result.rows[0]);

  const lookup = await pool.query('SELECT email, verified FROM users WHERE email = $1', [cleanEmail]);
  const user = lookup.rows[0];
  if (!user) throw emailNotRegisteredError();
  throw userInputError('This email is already verified.');
}

export async function listMovies(search = '') {
  if (!pool) {
    const store = await readLocalStore();
    const normalized = search.toLowerCase();
    return store.movies
      .filter((movie) => !normalized || movie.title.toLowerCase().includes(normalized))
      .map(toClientMovie);
  }

  const result = await pool.query(
    `SELECT * FROM movies
     WHERE $1 = '' OR title ILIKE '%' || $1 || '%' OR description ILIKE '%' || $1 || '%'
     ORDER BY created_at DESC`,
    [search]
  );
  return result.rows.map((row) => toClientMovie(rowToMovie(row)));
}

export async function listFavoriteMovieIds(userId) {
  if (!pool) {
    const store = await readLocalStore();
    return (store.favoriteMovies || []).filter((entry) => entry.userId === userId).map((entry) => entry.movieId);
  }

  const result = await pool.query('SELECT movie_id AS "movieId" FROM favorite_movies WHERE user_id = $1', [userId]);
  return result.rows.map((row) => row.movieId);
}

export async function listFavoriteMovies(userId) {
  if (!pool) {
    const store = await readLocalStore();
    const ids = new Set((store.favoriteMovies || []).filter((entry) => entry.userId === userId).map((entry) => entry.movieId));
    return store.movies.filter((movie) => ids.has(movie.id)).map((movie) => ({ ...toClientMovie(movie), favorite: true }));
  }

  const result = await pool.query(
    `SELECT m.*
     FROM favorite_movies f
     JOIN movies m ON m.id = f.movie_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows.map((row) => ({ ...toClientMovie(rowToMovie(row)), favorite: true }));
}

export async function isFavoriteMovie(userId, movieId) {
  if (!pool) {
    const store = await readLocalStore();
    return Boolean((store.favoriteMovies || []).find((entry) => entry.userId === userId && entry.movieId === movieId));
  }

  const result = await pool.query('SELECT 1 FROM favorite_movies WHERE user_id = $1 AND movie_id = $2 LIMIT 1', [userId, movieId]);
  return Boolean(result.rows[0]);
}

export async function addFavoriteMovie(userId, movieId) {
  if (!pool) {
    const store = await readLocalStore();
    const movie = store.movies.find((item) => item.id === movieId);
    if (!movie) throw userInputError('Movie not found.');
    store.favoriteMovies = Array.isArray(store.favoriteMovies) ? store.favoriteMovies : [];
    if (!store.favoriteMovies.some((entry) => entry.userId === userId && entry.movieId === movieId)) {
      store.favoriteMovies.unshift({ userId, movieId, createdAt: new Date().toISOString() });
      await writeLocalStore(store);
    }
    return { favorite: true };
  }

  await pool.query(
    `INSERT INTO favorite_movies (user_id, movie_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, movie_id) DO NOTHING`,
    [userId, movieId]
  );
  return { favorite: true };
}

export async function removeFavoriteMovie(userId, movieId) {
  if (!pool) {
    const store = await readLocalStore();
    const before = (store.favoriteMovies || []).length;
    store.favoriteMovies = (store.favoriteMovies || []).filter((entry) => !(entry.userId === userId && entry.movieId === movieId));
    if (before !== store.favoriteMovies.length) await writeLocalStore(store);
    return { favorite: false };
  }

  await pool.query('DELETE FROM favorite_movies WHERE user_id = $1 AND movie_id = $2', [userId, movieId]);
  return { favorite: false };
}

export async function listGenres() {
  if (!pool) {
    const store = await readLocalStore();
    return normalizeGenres(store.genres);
  }

  const result = await pool.query('SELECT name FROM genres ORDER BY name ASC');
  return normalizeGenres(result.rows.map((row) => row.name));
}

export async function getMovie(slug) {
  if (!pool) {
    const store = await readLocalStore();
    return toClientMovie(store.movies.find((movie) => movie.slug === slug));
  }

  const result = await pool.query('SELECT * FROM movies WHERE slug = $1', [slug]);
  return toClientMovie(rowToMovie(result.rows[0]));
}

export async function getMovieById(id) {
  if (!pool) {
    const store = await readLocalStore();
    return store.movies.find((movie) => movie.id === id) || null;
  }

  const result = await pool.query('SELECT * FROM movies WHERE id = $1', [id]);
  return rowToMovie(result.rows[0]);
}

export async function getClientMovieById(id) {
  const movie = await getMovieById(id);
  const clientMovie = toClientMovie(movie);
  if (!pool || !clientMovie) return clientMovie;

  const subtitles = await pool.query('SELECT language FROM subtitles WHERE movie_id = $1', [id]);
  const languages = new Set(subtitles.rows.map((row) => row.language));
  return {
    ...clientMovie,
    fileStatus: {
      ...clientMovie.fileStatus,
      subtitleEn: languages.has('en'),
      subtitleRu: languages.has('ru')
    },
    fileNames: {
      ...clientMovie.fileNames,
      subtitleEn: languages.has('en') ? 'English subtitles' : '',
      subtitleRu: languages.has('ru') ? 'Russian subtitles' : ''
    }
  };
}

export async function updateMovie(movieId, payload, files = {}) {
  const existing = await getStoredMovieById(movieId);
  if (!existing) throw userInputError('Movie not found.');
  const cover = files.cover?.[0];
  const video = await prepareUploadedVideo(files.video?.[0]);
  const movie = {
    ...existing,
    title: payload.title || existing.title,
    originalTitle: payload.originalTitle || existing.originalTitle || payload.title || existing.title,
    description: payload.description || existing.description,
    year: Number(payload.year) || existing.year,
    country: formatCountries(payload.country || existing.country),
    genres: parseGenres(payload.genres || payload.genre || existing.genres),
    type: payload.type || existing.type,
    duration: payload.duration || existing.duration,
    rating: Number(payload.rating) || existing.rating,
    difficulty: payload.difficulty || existing.difficulty,
    accent: payload.accent || existing.accent,
    ageRating: payload.ageRating || existing.ageRating,
    coverUrl: cover ? `/media/uploads/${cover.filename}` : existing.coverUrl,
    videoPath: video ? video.path : existing.videoPath
  };
  movie.genre = movie.genres.join(', ') || 'Drama';
  const subtitleEn = files.subtitleEn?.[0] ? parseSrt(await fs.readFile(files.subtitleEn[0].path, 'utf8')) : null;
  const subtitleRu = files.subtitleRu?.[0] ? parseSrt(await fs.readFile(files.subtitleRu[0].path, 'utf8')) : null;
  await cleanupTempFiles([files.subtitleEn?.[0]?.path, files.subtitleRu?.[0]?.path, video?.originalPath]);

  if (!pool) {
    const store = await readLocalStore();
    const index = store.movies.findIndex((item) => item.id === movieId);
    if (index < 0) throw userInputError('Movie not found.');
    const current = store.movies[index];
    store.movies[index] = {
      ...current,
      ...movie,
      subtitles: {
        ...(current.subtitles || {}),
        ...(subtitleEn ? { en: subtitleEn } : {}),
        ...(subtitleRu ? { ru: subtitleRu } : {})
      }
    };
    store.genres = normalizeGenres([...(store.genres || []), ...movie.genres]);
    await writeLocalStore(store);
    await cleanupReplacedMovieFiles(existing, { cover, video });
    return toClientMovie(store.movies[index]);
  }

  await ensureGenres(movie.genres);
  const result = await pool.query(
    `UPDATE movies
     SET title = $2, original_title = $3, description = $4, year = $5, country = $6,
         genre = $7, genres = $8::jsonb, type = $9, duration = $10, rating = $11,
         difficulty = $12, accent = $13, age_rating = $14, cover_url = $15,
         video_path = $16, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      movieId,
      movie.title,
      movie.originalTitle,
      movie.description,
      movie.year,
      movie.country,
      movie.genre,
      JSON.stringify(movie.genres),
      movie.type,
      movie.duration,
      movie.rating,
      movie.difficulty,
      movie.accent,
      movie.ageRating,
      movie.coverUrl,
      movie.videoPath
    ]
  );
  if (subtitleEn) await upsertSubtitle(movieId, 'en', subtitleEn);
  if (subtitleRu) await upsertSubtitle(movieId, 'ru', subtitleRu);
  await cleanupReplacedMovieFiles(existing, { cover, video });
  return toClientMovie(rowToMovie(result.rows[0]));
}

export async function deleteMovie(movieId) {
  const existing = await getStoredMovieById(movieId);
  if (!pool) {
    const store = await readLocalStore();
    const before = store.movies.length;
    store.movies = store.movies.filter((movie) => movie.id !== movieId);
    store.favoriteMovies = (store.favoriteMovies || []).filter((entry) => entry.movieId !== movieId);
    await writeLocalStore(store);
    await cleanupMovieFiles(existing);
    return { deleted: before - store.movies.length };
  }

  const result = await pool.query('DELETE FROM movies WHERE id = $1', [movieId]);
  await cleanupMovieFiles(existing);
  return { deleted: result.rowCount };
}

export async function optimizeStoredVideos() {
  if (!pool) {
    const store = await readLocalStore();
    let changed = 0;
    for (const movie of store.movies) {
      const nextPath = await optimizeExistingVideoPath(movie.videoPath);
      if (nextPath && nextPath !== movie.videoPath) {
        movie.videoPath = nextPath;
        changed += 1;
      }
    }
    if (changed) await writeLocalStore(store);
    return { optimized: changed };
  }

  const result = await pool.query('SELECT id, video_path FROM movies ORDER BY created_at DESC');
  let changed = 0;
  for (const row of result.rows) {
    const nextPath = await optimizeExistingVideoPath(row.video_path);
    if (nextPath && nextPath !== row.video_path) {
      await pool.query('UPDATE movies SET video_path = $2, updated_at = now() WHERE id = $1', [row.id, nextPath]);
      changed += 1;
    }
  }
  return { optimized: changed };
}

async function ensureLocalUserForAdmin(admin) {
  const store = await readLocalUsers();
  const email = String(admin.email || '').trim().toLowerCase();
  let user = store.users.find((item) => item.email === email);
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      username: adminAccount.username || email.split('@')[0],
      email,
      passwordHash: admin.passwordHash,
      role: 'admin',
      language: defaultLanguage,
      verified: true,
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
  } else {
    user.username = user.username || adminAccount.username || email.split('@')[0];
    user.passwordHash = admin.passwordHash || user.passwordHash;
    user.role = 'admin';
    user.verified = true;
    user.language = normalizeLanguage(user.language);
  }
  await writeLocalUsers(store);
  return { id: user.id, username: user.username || email.split('@')[0], email: user.email, language: user.language || defaultLanguage };
}

async function ensureDatabaseUserForAdmin(admin) {
  const email = String(admin.email || '').trim().toLowerCase();
  const username = adminAccount.username || email.split('@')[0];
  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash, role, language, verified, verification_code, verification_expires_at)
     VALUES ($1, $2, $3, 'admin', $4, true, NULL, NULL)
     ON CONFLICT (email) DO UPDATE
     SET username = CASE WHEN users.username = '' THEN EXCLUDED.username ELSE users.username END,
         password_hash = EXCLUDED.password_hash,
         role = 'admin',
         verified = true,
         verification_code = NULL,
         verification_expires_at = NULL
     RETURNING id, username, email, language`,
    [username, email, admin.password_hash, defaultLanguage]
  );
  const user = result.rows[0];
  return { id: user.id, username: user.username || email.split('@')[0], email: user.email, language: user.language || defaultLanguage };
}

export async function getUserByIdentity(identity = {}) {
  if (!identity.id && !identity.email) return null;

  if (!pool) {
    const store = await readLocalUsers();
    const cleanEmail = String(identity.email || '').trim().toLowerCase();
    let user = store.users.find((item) => item.id === identity.id || item.email === cleanEmail);
    if (!user && cleanEmail) {
      const admins = await readLocalAdmins();
      const admin = admins.admins.find((item) => item.email === cleanEmail);
      if (admin) user = await ensureLocalUserForAdmin(admin);
    }
    if (!user) return null;
    return { id: user.id, username: user.username || user.email.split('@')[0], email: user.email, language: user.language || defaultLanguage };
  }

  const cleanEmail = String(identity.email || '').trim().toLowerCase();
  let result = identity.id
    ? await pool.query('SELECT id, username, email, language FROM users WHERE id = $1', [identity.id])
    : await pool.query('SELECT id, username, email, language FROM users WHERE email = $1', [cleanEmail]);
  let user = result.rows[0];
  if (!user && cleanEmail) {
    result = await pool.query('SELECT id, username, email, language FROM users WHERE email = $1', [cleanEmail]);
    user = result.rows[0];
  }
  if (!user && cleanEmail) {
    const adminResult = await pool.query('SELECT id, email, password_hash FROM admins WHERE email = $1', [cleanEmail]);
    const admin = adminResult.rows[0];
    if (admin) user = await ensureDatabaseUserForAdmin(admin);
  }
  if (!user) return null;
  return { id: user.id, username: user.username, email: user.email, language: user.language || defaultLanguage };
}

export async function updateUserLanguage(userId, language) {
  const nextLanguage = normalizeLanguage(language);

  if (!pool) {
    const store = await readLocalUsers();
    const user = store.users.find((item) => item.id === userId);
    if (!user) throw userInputError('User not found.');
    user.language = nextLanguage;
    await writeLocalUsers(store);
    return { id: user.id, username: user.username || user.email.split('@')[0], email: user.email, language: user.language };
  }

  const result = await pool.query(
    'UPDATE users SET language = $2 WHERE id = $1 RETURNING id, username, email, language',
    [userId, nextLanguage]
  );
  const user = result.rows[0];
  if (!user) throw userInputError('User not found.');
  return { id: user.id, username: user.username, email: user.email, language: user.language };
}

export async function getSubtitles(movieId, language) {
  if (!pool) {
    const store = await readLocalStore();
    const movie = store.movies.find((item) => item.id === movieId);
    const subtitles = movie?.subtitles || {};
    return subtitles[language] || [];
  }

  const result = await pool.query('SELECT cues FROM subtitles WHERE movie_id = $1 AND language = $2', [
    movieId,
    language
  ]);
  return result.rows[0]?.cues || [];
}

export async function createMovie(payload, files) {
  const video = await prepareUploadedVideo(files.video?.[0]);
  if (!video) throw new Error('A video file is required.');
  const cover = files.cover?.[0];
  const subtitleEnFile = files.subtitleEn?.[0];
  const subtitleRuFile = files.subtitleRu?.[0];
  if (!cover) throw new Error('A cover image is required.');
  if (!subtitleEnFile) throw new Error('English subtitles are required.');
  if (!subtitleRuFile) throw new Error('Russian subtitles are required.');

  const slug = slugify(payload.title);
  const movie = {
    id: crypto.randomUUID(),
    slug,
    title: payload.title,
    originalTitle: payload.originalTitle || payload.title,
    description: payload.description || 'Uploaded for English practice.',
    year: Number(payload.year) || new Date().getFullYear(),
    country: formatCountries(payload.country || 'USA'),
    genres: parseGenres(payload.genres || payload.genre),
    genre: '',
    type: payload.type || 'Movie',
    duration: payload.duration || '',
    rating: Number(payload.rating) || 8,
    difficulty: payload.difficulty || 'medium',
    accent: payload.accent || 'american',
    ageRating: payload.ageRating || '16+',
    coverUrl: cover ? `/media/uploads/${cover.filename}` : null,
    videoPath: video.path
  };
  movie.genre = movie.genres.join(', ') || 'Drama';

  const subtitleEn = parseSrt(await fs.readFile(subtitleEnFile.path, 'utf8'));
  const subtitleRu = parseSrt(await fs.readFile(subtitleRuFile.path, 'utf8'));
  await cleanupTempFiles([subtitleEnFile.path, subtitleRuFile.path, video.originalPath]);

  if (!pool) {
    const store = await readLocalStore();
    store.movies.unshift({ ...movie, subtitles: { en: subtitleEn, ru: subtitleRu } });
    store.genres = normalizeGenres([...(store.genres || []), ...movie.genres]);
    await writeLocalStore(store);
    return toClientMovie(movie);
  }

  await ensureGenres(movie.genres);
  const inserted = await pool.query(
    `INSERT INTO movies (
      slug, title, original_title, description, year, country, genre, genres, type, duration,
      rating, difficulty, accent, age_rating, cover_url, video_path
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *`,
    [
      movie.slug,
      movie.title,
      movie.originalTitle,
      movie.description,
      movie.year,
      movie.country,
      movie.genre,
      JSON.stringify(movie.genres),
      movie.type,
      movie.duration,
      movie.rating,
      movie.difficulty,
      movie.accent,
      movie.ageRating,
      movie.coverUrl,
      movie.videoPath
    ]
  );

  await upsertSubtitle(inserted.rows[0].id, 'en', subtitleEn);
  await upsertSubtitle(inserted.rows[0].id, 'ru', subtitleRu);
  return toClientMovie(rowToMovie(inserted.rows[0]));
}

export async function listVocabulary(userId) {
  if (!pool) {
    const store = await readLocalStore();
    return (store.vocabulary || [])
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const result = await pool.query(
    `SELECT id, user_id AS "userId", word, translation, source_language AS "sourceLanguage",
            target_language AS "targetLanguage", created_at AS "createdAt"
     FROM vocabulary
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function addVocabulary(userId, payload) {
  const word = normalizeLookupValue(payload.word);
  const translation = String(payload.translation || '').trim();
  const sourceLanguage = normalizeSubtitleLanguage(payload.sourceLanguage || payload.lang || 'en');
  const targetLanguage = normalizeSubtitleLanguage(payload.targetLanguage || (sourceLanguage === 'ru' ? 'en' : 'ru'));

  if (!word) throw userInputError('Word is required.');
  if (!translation) throw userInputError('Translation is required.');

  if (!pool) {
    const store = await readLocalStore();
    const existing = (store.vocabulary || []).find(
      (entry) =>
        entry.userId === userId &&
        entry.word.toLowerCase() === word.toLowerCase() &&
        entry.sourceLanguage === sourceLanguage &&
        entry.targetLanguage === targetLanguage
    );
    if (existing) {
      existing.translation = translation;
      await writeLocalStore(store);
      return existing;
    }
    const entry = {
      id: crypto.randomUUID(),
      userId,
      word,
      translation,
      sourceLanguage,
      targetLanguage,
      createdAt: new Date().toISOString()
    };
    store.vocabulary = [entry, ...(store.vocabulary || [])];
    await writeLocalStore(store);
    return entry;
  }

  const result = await pool.query(
    `INSERT INTO vocabulary (user_id, word, translation, source_language, target_language)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, word, source_language, target_language)
     DO UPDATE SET translation = EXCLUDED.translation
     RETURNING id, user_id AS "userId", word, translation, source_language AS "sourceLanguage",
               target_language AS "targetLanguage", created_at AS "createdAt"`,
    [userId, word, translation, sourceLanguage, targetLanguage]
  );
  return result.rows[0];
}

export async function findVocabularyEntry(userId, payload) {
  const word = normalizeLookupValue(payload.word);
  const sourceLanguage = normalizeSubtitleLanguage(payload.sourceLanguage || payload.lang || 'en');
  const targetLanguage = normalizeSubtitleLanguage(payload.targetLanguage || (sourceLanguage === 'ru' ? 'en' : 'ru'));
  if (!word) return null;

  if (!pool) {
    const store = await readLocalStore();
    return (
      (store.vocabulary || []).find(
        (entry) =>
          entry.userId === userId &&
          normalizeLookupValue(entry.word).toLowerCase() === word.toLowerCase() &&
          entry.sourceLanguage === sourceLanguage &&
          entry.targetLanguage === targetLanguage
      ) || null
    );
  }

  const result = await pool.query(
    `SELECT id, user_id AS "userId", word, translation, source_language AS "sourceLanguage",
            target_language AS "targetLanguage", created_at AS "createdAt"
     FROM vocabulary
     WHERE user_id = $1 AND lower(word) = lower($2) AND source_language = $3 AND target_language = $4
     LIMIT 1`,
    [userId, word, sourceLanguage, targetLanguage]
  );
  return result.rows[0] || null;
}

export async function removeVocabulary(userId, entryId) {
  if (!pool) {
    const store = await readLocalStore();
    const next = (store.vocabulary || []).filter((entry) => !(entry.userId === userId && entry.id === entryId));
    const changed = next.length !== (store.vocabulary || []).length;
    store.vocabulary = next;
    await writeLocalStore(store);
    return changed;
  }

  const result = await pool.query('DELETE FROM vocabulary WHERE user_id = $1 AND id = $2', [userId, entryId]);
  return result.rowCount > 0;
}

async function upsertSubtitle(movieId, language, cues) {
  await pool.query(
    `INSERT INTO subtitles (movie_id, language, cues)
     VALUES ($1, $2, $3)
     ON CONFLICT (movie_id, language) DO UPDATE SET cues = EXCLUDED.cues`,
    [movieId, language, JSON.stringify(cues)]
  );
}

function rowToMovie(row) {
  if (!row) return null;
  const genres = parseGenres(row.genres || row.genre);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    originalTitle: row.original_title,
    description: row.description,
    year: row.year,
    country: row.country,
    genre: row.genre,
    genres,
    type: row.type,
    duration: row.duration,
    rating: Number(row.rating),
    difficulty: row.difficulty,
    accent: row.accent,
    ageRating: row.age_rating,
    coverUrl: row.cover_url,
    videoPath: row.video_path
  };
}

function toClientMovie(movie) {
  if (!movie) return null;
  const { subtitleEnPath, subtitleRuPath, subtitles, videoPath, ...clientMovie } = movie;
  return {
    ...clientMovie,
    fileStatus: {
      cover: Boolean(movie.coverUrl),
      video: Boolean(videoPath),
      subtitleEn: Boolean(subtitles?.en?.length || subtitleEnPath),
      subtitleRu: Boolean(subtitles?.ru?.length || subtitleRuPath)
    },
    fileNames: {
      cover: movie.coverUrl ? path.basename(movie.coverUrl) : '',
      video: videoPath ? path.basename(videoPath) : '',
      subtitleEn: subtitleEnPath ? path.basename(subtitleEnPath) : subtitles?.en?.length ? 'English subtitles' : '',
      subtitleRu: subtitleRuPath ? path.basename(subtitleRuPath) : subtitles?.ru?.length ? 'Russian subtitles' : ''
    }
  };
}

async function getStoredMovieById(id) {
  if (!pool) {
    const store = await readLocalStore();
    return store.movies.find((movie) => movie.id === id) || null;
  }

  const result = await pool.query('SELECT * FROM movies WHERE id = $1', [id]);
  return rowToMovie(result.rows[0]);
}

async function cleanupReplacedMovieFiles(existing, replacements) {
  const paths = [];
  if (replacements.cover && existing.coverUrl?.startsWith('/media/uploads/')) {
    paths.push(path.resolve('storage/uploads', path.basename(existing.coverUrl)));
  }
  if (replacements.video && existing.videoPath) {
    paths.push(path.resolve(existing.videoPath));
  }

  await Promise.all(paths.map((filePath) => fs.unlink(filePath).catch(() => {})));
}

async function cleanupTempFiles(paths = []) {
  await Promise.all(paths.filter(Boolean).map((filePath) => fs.unlink(path.resolve(filePath)).catch(() => {})));
}

async function cleanupMovieFiles(movie) {
  if (!movie) return;
  const paths = [];
  if (movie.coverUrl?.startsWith('/media/uploads/')) paths.push(path.resolve('storage/uploads', path.basename(movie.coverUrl)));
  if (movie.videoPath) paths.push(path.resolve(movie.videoPath));
  await Promise.all(paths.map((filePath) => fs.unlink(filePath).catch(() => {})));
}

async function ensureLocalStore() {
  await fs.mkdir(path.dirname(localStorePath), { recursive: true });
  try {
    await fs.access(localStorePath);
    const store = JSON.parse(await fs.readFile(localStorePath, 'utf8'));
    const currentMovies = Array.isArray(store.movies) ? store.movies : [];
    const movies = currentMovies.filter((movie) => movie?.slug !== legacySampleSlug).map(normalizeStoredMovie);
    const genres = normalizeGenres([...(Array.isArray(store.genres) ? store.genres : []), ...defaultGenres, ...movies.flatMap((movie) => movie.genres || [])]);
    const vocabulary = Array.isArray(store.vocabulary) ? store.vocabulary : [];
    const favoriteMovies = Array.isArray(store.favoriteMovies) ? store.favoriteMovies : [];
    if (
      movies.length !== currentMovies.length ||
      !Array.isArray(store.movies) ||
      !Array.isArray(store.genres) ||
      !Array.isArray(store.vocabulary) ||
      !Array.isArray(store.favoriteMovies)
    ) {
      store.movies = movies;
      store.genres = genres;
      store.vocabulary = vocabulary;
      store.favoriteMovies = favoriteMovies;
      await writeLocalStore(store);
    }
  } catch {
    await writeLocalStore({ movies: [], genres: [...defaultGenres], vocabulary: [], favoriteMovies: [] });
  }
}

async function readLocalStore() {
  await ensureLocalStore();
  return JSON.parse(await fs.readFile(localStorePath, 'utf8'));
}

async function writeLocalStore(store) {
  await fs.writeFile(localStorePath, JSON.stringify(store, null, 2));
}

async function readLocalUsers() {
  await fs.mkdir(path.dirname(localUsersPath), { recursive: true });
  try {
    return JSON.parse(await fs.readFile(localUsersPath, 'utf8'));
  } catch {
    const store = { users: [] };
    await writeLocalUsers(store);
    return store;
  }
}

async function writeLocalUsers(store) {
  await fs.writeFile(localUsersPath, JSON.stringify(store, null, 2));
}

async function readLocalAdmins() {
  await fs.mkdir(path.dirname(localAdminsPath), { recursive: true });
  try {
    return JSON.parse(await fs.readFile(localAdminsPath, 'utf8'));
  } catch {
    const store = { admins: [] };
    await writeLocalAdmins(store);
    return store;
  }
}

async function writeLocalAdmins(store) {
  await fs.writeFile(localAdminsPath, JSON.stringify(store, null, 2));
}

async function ensureLocalAdminsSeed() {
  const store = await readLocalAdmins();
  const existing = store.admins.find((admin) => admin.email === adminAccount.email);
  const seeded = {
    id: existing?.id || crypto.randomUUID(),
    email: adminAccount.email,
    passwordHash: await bcrypt.hash(adminAccount.password, 12),
    createdAt: existing?.createdAt || new Date().toISOString()
  };
  store.admins = [seeded];
  await writeLocalAdmins(store);
}

async function ensureLocalUsersSeed() {
  const store = await readLocalUsers();
  const accounts = dedupeAccounts([defaultUser, adminAccount]);
  for (const account of accounts) {
    const existing = store.users.find((user) => user.email === account.email);
    const seeded = {
      id: existing?.id || crypto.randomUUID(),
      username: account.username,
      email: account.email,
      role: account.role || 'user',
      language: existing?.language || defaultLanguage,
      passwordHash: await bcrypt.hash(account.password, 12),
      verified: true,
      verificationCode: null,
      verificationExpiresAt: null,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (existing) Object.assign(existing, seeded);
    else store.users.push(seeded);
  }
  await writeLocalUsers(store);
}

async function ensureSeedUsersInDatabase() {
  const accounts = dedupeAccounts([defaultUser, adminAccount]);
  for (const account of accounts) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    await pool.query(
      `INSERT INTO users (username, email, password_hash, role, verified, verification_code, verification_expires_at)
       VALUES ($1, $2, $3, $4, true, NULL, NULL)
       ON CONFLICT (email) DO UPDATE
       SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, language = COALESCE(users.language, 'tm'), verified = true, verification_code = NULL, verification_expires_at = NULL`,
      [account.username, account.email, passwordHash, account.role || 'user']
    );
  }
}

async function ensureDefaultGenresInDatabase() {
  await ensureGenres(defaultGenres);
}

async function ensureGenres(genres = []) {
  const normalized = normalizeGenres([...defaultGenres, ...genres]);
  if (!pool) return normalized;
  for (const genre of normalized) {
    await pool.query('INSERT INTO genres (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [genre]);
  }
  return normalized;
}

function slugify(value) {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${base || 'movie'}-${Date.now().toString(36)}`;
}

function userInputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function emailNotRegisteredError() {
  const error = new Error('Email is not registered.');
  error.status = 404;
  error.code = 'EMAIL_NOT_REGISTERED';
  return error;
}

function invalidPasswordError() {
  const error = new Error('Incorrect password.');
  error.status = 401;
  error.code = 'INVALID_PASSWORD';
  return error;
}

function emailNotVerifiedError(email) {
  const error = new Error('Email is not verified yet.');
  error.status = 403;
  error.code = 'EMAIL_NOT_VERIFIED';
  error.email = email;
  return error;
}

function invalidVerificationCodeError(email) {
  const error = new Error('Incorrect verification code.');
  error.status = 400;
  error.code = 'INVALID_VERIFICATION_CODE';
  error.email = email;
  return error;
}

function verificationExpiredError(email) {
  const error = new Error('Verification code expired. Request a new one.');
  error.status = 400;
  error.code = 'VERIFICATION_CODE_EXPIRED';
  error.email = email;
  return error;
}

function isStrongPassword(value) {
  const password = String(value || '');
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function parseGenres(input) {
  if (!input) return [];
  if (Array.isArray(input)) return normalizeGenres(input);
  const value = String(input).trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return normalizeGenres(parsed);
  } catch {
    return normalizeGenres(value.split(','));
  }
  return [];
}

function normalizeGenres(values) {
  return [...new Set(values.map((value) => canonicalizeGenre(value)).filter(Boolean))];
}

function parseCountries(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((country) => String(country || '').trim()).filter(Boolean);
  const value = String(input).trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((country) => String(country || '').trim()).filter(Boolean);
  } catch {}
  return value.split(',').map((country) => country.trim()).filter(Boolean);
}

function formatCountries(input) {
  const countries = [...new Set(parseCountries(input))];
  return countries.length ? countries.join(', ') : 'USA';
}

function dedupeAccounts(accounts) {
  const map = new Map();
  accounts.forEach((account) => map.set(account.email, account));
  return [...map.values()];
}

function normalizeLanguage(value) {
  return ['tm', 'en', 'ru'].includes(value) ? value : defaultLanguage;
}

function normalizeRole(value) {
  return value === 'admin' ? 'admin' : 'user';
}

function isDemoEmail(email) {
  return String(email || '').toLowerCase().endsWith('@example.com');
}

function normalizeSubtitleLanguage(value) {
  return value === 'ru' ? 'ru' : 'en';
}

function normalizeLookupValue(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:()[\]{}"«»]/g, '')
    .trim();
}

function canonicalizeGenre(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const matched = defaultGenres.find((genre) => genre.toLowerCase() === clean.toLowerCase());
  if (matched) return matched;
  if (clean.toLowerCase() === 'sci fi' || clean.toLowerCase() === 'sci-fi' || clean.toLowerCase() === 'scifi') return 'Sci-Fi';
  return clean;
}

function normalizeStoredMovie(movie) {
  const genres = parseGenres(movie?.genres || movie?.genre);
  return {
    ...movie,
    genres,
    genre: genres.join(', ') || movie?.genre || ''
  };
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getVerificationExpiry() {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString();
}

function toPendingVerification(user) {
  return {
    username: user.username,
    email: user.email,
    verificationCode: user.verificationCode || user.verification_code,
    verificationExpiresAt: user.verificationExpiresAt || user.verification_expires_at
  };
}

function toClientUser(user) {
  return {
    id: user.id,
    username: user.username || user.email.split('@')[0],
    email: user.email,
    language: user.language || defaultLanguage
  };
}

function toAdminUser(user) {
  return {
    id: user.id,
    username: user.username || user.email.split('@')[0],
    email: user.email,
    role: normalizeRole(user.role),
    language: user.language || defaultLanguage,
    verified: Boolean(user.verified),
    createdAt: user.createdAt || user.created_at
  };
}

async function findUserByResetCode(email, code) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanCode = String(code || '').trim();
  if (!/^\d{6}$/.test(cleanCode)) throw userInputError('Enter the 6-digit verification code.');

  if (!pool) {
    const store = await readLocalUsers();
    const user = store.users.find((item) => item.email === cleanEmail && item.verified);
    if (!user) throw emailNotRegisteredError();
    if (!user.verificationCode || !user.verificationExpiresAt || Date.parse(user.verificationExpiresAt) < Date.now()) {
      throw verificationExpiredError(cleanEmail);
    }
    if (String(user.verificationCode) !== cleanCode) throw invalidVerificationCodeError(cleanEmail);
    return user;
  }

  const result = await pool.query(
    `SELECT id, email, verification_expires_at
     FROM users
     WHERE email = $1
       AND verified = true
       AND verification_code = $2
       AND verification_expires_at IS NOT NULL
       AND verification_expires_at >= now()`,
    [cleanEmail, cleanCode]
  );
  if (result.rows[0]) return result.rows[0];

  const exists = await pool.query('SELECT email, verification_expires_at FROM users WHERE email = $1 AND verified = true', [cleanEmail]);
  if (!exists.rows[0]) throw emailNotRegisteredError();
  if (!exists.rows[0].verification_expires_at || new Date(exists.rows[0].verification_expires_at).getTime() < Date.now()) {
    throw verificationExpiredError(cleanEmail);
  }
  throw invalidVerificationCodeError(cleanEmail);
}
