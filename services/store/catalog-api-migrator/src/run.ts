// Runs after `prisma migrate deploy` (see package.json): seeds the catalog, then exits.
import { SQL } from 'bun';
import { applySeed } from './seed';
import { cleanDatabaseUrl } from './db';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Flisk provides it when the service enables the prisma feature.');

const sql = new SQL(cleanDatabaseUrl(url));
await applySeed(sql);
console.log('catalog: seed applied');
await sql.close();
