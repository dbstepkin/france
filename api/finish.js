import { pollState, pollAnswers, saveResult } from '../lib/store.js';
import { buildCloud } from '../lib/cluster.js';

export async function POST() {
  const s = await pollState();
  if (s.result) return Response.json({ cloud: s.result });
  const answers = await pollAnswers();
  if (!answers.length) return Response.json({ error: 'Пока нет ни одного ответа' }, { status: 400 });

  const cloud = await buildCloud(answers);
  await saveResult(cloud);
  return Response.json({ cloud });
}
