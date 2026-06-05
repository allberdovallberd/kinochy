import '../env.js';
import { initDatabase, optimizeStoredVideos } from '../db.js';

await initDatabase();
const result = await optimizeStoredVideos();
console.log(
  `Optimized ${result.optimized} video file${result.optimized === 1 ? '' : 's'}, skipped ${result.skipped || 0} missing file${
    result.skipped === 1 ? '' : 's'
  }.`
);
