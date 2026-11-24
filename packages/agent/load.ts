import '../../config/env';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ConfigSchema, MemberSchema, PastClaimSchema } from '../types/index';
export const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): unknown => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
export function loadData(configPath = 'config/lumen.json') {
  return {config: ConfigSchema.parse(read(configPath)), members: z.array(MemberSchema).parse(read('data/members.json')), pastClaims: z.array(PastClaimSchema).parse(read('data/past-claims.json'))};
}
export type Data = ReturnType<typeof loadData>;
