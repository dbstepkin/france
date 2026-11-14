import { resetAll } from '../lib/store.js';

export async function POST() {
  await resetAll();
  return Response.json({ ok: true });
}
