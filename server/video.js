import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function prepareUploadedVideo(file) {
  if (!file?.path) return file;
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
  if (!filePath || isPreparedMp4(filePath)) return filePath;
  return optimizeVideoFile(filePath);
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
  return outputPath;
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
