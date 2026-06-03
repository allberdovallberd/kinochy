import fs from 'node:fs/promises';
import path from 'node:path';

const cachePath = path.resolve('storage/translation-cache.json');

export async function translateText({ text, from = 'en', to = 'ru' }) {
  const cleanText = String(text || '').trim().slice(0, 120);
  if (!cleanText) return { text: cleanText, translation: '' };

  const key = `${from}:${to}:${cleanText.toLowerCase()}`;
  const cache = await readCache();
  if (cache[key] && cache[key].toLowerCase() !== cleanText.toLowerCase()) {
    return { text: cleanText, translation: cache[key], cached: true };
  }

  const preferred = process.env.TRANSLATE_PROVIDER || 'libretranslate';
  let translation = '';

  try {
    translation = preferred === 'mymemory' ? await translateWithMyMemory(cleanText, from, to) : await translateWithLibre(cleanText, from, to);
  } catch (primaryError) {
    try {
      translation = preferred === 'mymemory' ? await translateWithLibre(cleanText, from, to) : await translateWithMyMemory(cleanText, from, to);
    } catch {
      return { text: cleanText, translation: '', cached: false, unavailable: true, message: primaryError.message };
    }
  }

  if (translation.toLowerCase() === cleanText.toLowerCase() && preferred !== 'libretranslate') {
    try {
      translation = await translateWithLibre(cleanText, from, to);
    } catch {}
  }

  cache[key] = translation;
  await writeCache(cache);
  return { text: cleanText, translation, cached: false };
}

async function translateWithMyMemory(text, from, to) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `${from}|${to}`);
  url.searchParams.set('mt', '1');
  if (process.env.MYMEMORY_EMAIL) url.searchParams.set('de', process.env.MYMEMORY_EMAIL);

  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error('Translation service is unavailable.');
  const data = await response.json();
  return data.responseData?.translatedText || '';
}

async function translateWithLibre(text, from, to) {
  const response = await fetch(process.env.LIBRETRANSLATE_URL || 'https://translate.mstdn.social/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(6000),
    body: JSON.stringify({
      q: text,
      source: from,
      target: to,
      format: 'text',
      api_key: process.env.LIBRETRANSLATE_API_KEY || ''
    })
  });
  if (!response.ok) throw new Error('Translation service is unavailable.');
  const data = await response.json();
  return data.translatedText || '';
}

async function readCache() {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

async function writeCache(cache) {
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
}
