import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
// Real environment variables take precedence, then .env.local, then .env.
config({path: [fileURLToPath(new URL('../.env.local', import.meta.url)), fileURLToPath(new URL('../.env', import.meta.url))], quiet: true});
