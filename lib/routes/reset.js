import { resetAll } from '../store.js';

export async function POST() {
  await resetAll();
  return Response.json({ ok: true });
}
