export function parseSrt(content = '') {
  return content
    .replace(/\r/g, '')
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.trim().split('\n').filter(Boolean);
      if (lines.length < 2) return null;

      const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
      if (timeLineIndex === -1) return null;

      const [startRaw, endRaw] = lines[timeLineIndex].split('-->').map((part) => part.trim());
      const text = lines
        .slice(timeLineIndex + 1)
        .join('\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\{\\[^}]+\}/g, '')
        .trim();
      if (!text) return null;

      return {
        start: toSeconds(startRaw),
        end: toSeconds(endRaw),
        text
      };
    })
    .filter(Boolean);
}

function toSeconds(value) {
  const [time, ms = '0'] = value.replace(',', '.').split('.');
  const parts = time.split(':').map(Number);
  const hours = parts.length === 3 ? parts[0] : 0;
  const minutes = parts.length === 3 ? parts[1] : parts[0];
  const seconds = parts.length === 3 ? parts[2] : parts[1];
  return hours * 3600 + minutes * 60 + seconds + Number(`0.${ms.padEnd(3, '0').slice(0, 3)}`);
}
