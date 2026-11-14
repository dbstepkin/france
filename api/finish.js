import { snapshot, readResult, saveResult } from '../lib/store.js';
import { buildCloud } from '../lib/cluster.js';

export async function POST() {
  const snap = await snapshot(0);
  if (snap.resultBlob) return Response.json({ cloud: await readResult(snap.resultBlob) });
  if (!snap.answers.length) return Response.json({ error: 'Пока нет ни одного ответа' }, { status: 400 });

  const cloud = await buildCloud(snap.answers);
  await saveResult(cloud);
  return Response.json({ cloud });
}
