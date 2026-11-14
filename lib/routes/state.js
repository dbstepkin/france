import { pollState } from '../store.js';

export async function GET() {
  try {
    const s = await pollState();
    return Response.json(
      { pollId: s.pollId, count: s.count, finished: !!s.result, cloud: s.result },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
