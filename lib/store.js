// Хранилище опроса «Что для вас Франция?» в Redis.
import { pipeline, cmd, parse } from './kv.js';

const K = { id: 'poll:id', answers: 'poll:answers', result: 'poll:result' };

export async function pollState() {
  const [id, count, result] = await pipeline([['GET', K.id], ['LLEN', K.answers], ['GET', K.result]]);
  return { pollId: id || '0', count: Number(count) || 0, result: parse(result) };
}

export async function pollAnswers() {
  return (await cmd('LRANGE', K.answers, 0, -1)).map((s) => parse(s, [])).filter(Array.isArray);
}

export async function addAnswer(words) {
  await cmd('RPUSH', K.answers, JSON.stringify(words));
}

export async function saveResult(data) {
  await cmd('SET', K.result, JSON.stringify(data));
}

export async function resetAll() {
  await pipeline([['DEL', K.answers, K.result], ['SET', K.id, Date.now()]]);
}
