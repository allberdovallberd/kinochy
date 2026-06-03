import '../env.js';
import { initDatabase } from '../db.js';

await initDatabase();
console.log('Database initialized.');
