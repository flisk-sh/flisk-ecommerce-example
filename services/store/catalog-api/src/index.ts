import { SQL } from 'bun';
import { createApp } from './app';
import { cleanDatabaseUrl } from './db';

// Flisk provides DATABASE_URL (prisma feature). The schema is applied by catalog-api-migrator, not here.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Flisk provides it when the service enables the prisma feature.');

const sql = new SQL(cleanDatabaseUrl(url));
const app = createApp(sql);

const port = process.env.PORT || 3000;
console.log('\n🚀 catalog-api running on http://localhost:' + port);
console.log('📊 Health check: http://localhost:' + port + '/health\n');

export default {
  port,
  fetch: app.fetch,
};
