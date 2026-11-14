import { snapshot, readResult } from '../lib/store.js';

export async function GET() {
  const snap = await snapshot();
  const cloud = await readResult(snap.resultBlob);
  return Response.json(
    { pollId: snap.pollId, count: snap.answers.length, finished: !!cloud, cloud },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
