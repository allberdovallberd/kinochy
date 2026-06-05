import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function prepareUploadedVideo(file) {
  if (!file?.path) return file;
  if (process.env.VIDEO_OPTIMIZE_ON_UPLOAD !== 'true') return file;
  const optimizedPath = await optimizeVideoFile(file.path);
  if (optimizedPath === file.path) return file;
  return {
    ...file,
    path: optimizedPath,
    filename: path.basename(optimizedPath),
    originalPath: file.path
  };
}

export async function optimizeExistingVideoPath(filePath) {
  if (!filePath) return filePath;
  if (isPreparedMp4(filePath)) {
    await ensureHlsPlaylist(filePath);
    return filePath;
  }
  return optimizeVideoFile(filePath);
}

export function hlsDirectoryForVideoPath(filePath) {
  if (!filePath) return '';
  const ext = path.extname(filePath);
  return path.join(path.dirname(filePath), `${path.basename(filePath, ext)}.hls`);
}

export function hlsPlaylistPathForVideo(filePath) {
  const dir = hlsDirectoryForVideoPath(filePath);
  return dir ? path.join(dir, 'index.m3u8') : '';
}

export function hasHlsPlaylist(filePath) {
  const playlistPath = hlsPlaylistPathForVideo(filePath);
  return Boolean(playlistPath && fsSync.existsSync(playlistPath));
}

export function hlsSegmentPathForVideo(filePath, segmentName) {
  const cleanName = path.basename(String(segmentName || ''));
  if (!/^segment-\d{5}\.ts$/i.test(cleanName)) return '';
  const segmentPath = path.join(hlsDirectoryForVideoPath(filePath), cleanName);
  return fsSync.existsSync(segmentPath) ? segmentPath : '';
}

function isPreparedMp4(filePath) {
  return /\.stream\.mp4$/i.test(filePath);
}

async function optimizeVideoFile(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  const outputPath = path.join(path.dirname(inputPath), `${path.basename(inputPath, ext)}.${crypto.randomUUID()}.stream.mp4`);
  const copyArgs = [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    outputPath
  ];
  const transcodeArgs = [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-sn',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-force_key_frames',
    'expr:gte(t,n_forced*2)',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    outputPath
  ];

  try {
    await runFfmpeg(copyArgs);
  } catch {
    await removeFile(outputPath);
    try {
      await runFfmpeg(transcodeArgs);
    } catch (error) {
      await removeFile(outputPath);
      console.warn('[kinochy] Video optimization skipped:', error.message);
      return inputPath;
    }
  }

  await removeFile(inputPath);
  await ensureHlsPlaylist(outputPath);
  return outputPath;
}

async function ensureHlsPlaylist(inputPath) {
  if (process.env.VIDEO_HLS_ENABLE === 'false' || !inputPath || hasHlsPlaylist(inputPath)) return;
  const hlsDir = hlsDirectoryForVideoPath(inputPath);
  const tmpDir = `${hlsDir}.${crypto.randomUUID()}.tmp`;
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(tmpDir, { recursive: true });

  const segmentPath = path.join(tmpDir, 'segment-%05d.ts');
  const playlistPath = path.join(tmpDir, 'index.m3u8');
  const args = [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-sn',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-g',
    '48',
    '-keyint_min',
    '48',
    '-sc_threshold',
    '0',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-hls_time',
    '4',
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    segmentPath,
    playlistPath
  ];

  try {
    await runFfmpeg(args);
    await rewriteHlsPlaylist(playlistPath);
    await fs.rm(hlsDir, { recursive: true, force: true }).catch(() => {});
    await fs.rename(tmpDir, hlsDir);
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    console.warn('[kinochy] HLS generation skipped:', error.message);
  }
}

async function rewriteHlsPlaylist(playlistPath) {
  const playlist = await fs.readFile(playlistPath, 'utf8');
  const rewritten = playlist
    .split(/\r?\n/)
    .map((line) => {
      const clean = line.trim();
      if (!clean || clean.startsWith('#') || !/\.ts(?:$|\?)/i.test(clean)) return line;
      return `hls/${path.basename(clean)}`;
    })
    .join('\n');
  await fs.writeFile(playlistPath, `${rewritten.replace(/\n*$/, '')}\n`);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

async function removeFile(filePath) {
  await fs.unlink(filePath).catch(() => {});
}
