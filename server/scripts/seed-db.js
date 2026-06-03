import '../env.js';
import { initDatabase } from '../db.js';

await initDatabase();
console.log('Sample movie and admin account seeded.');
