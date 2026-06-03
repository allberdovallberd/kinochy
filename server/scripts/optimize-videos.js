import '../env.js';
import { initDatabase, optimizeStoredVideos } from '../db.js';

await initDatabase();
const result = await optimizeStoredVideos();
console.log(`Optimized ${result.optimized} video file${result.optimized === 1 ? '' : 's'}.`);
