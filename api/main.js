// Единая функция для всего API: так все запросы обслуживает один процесс
// с общей памятью (см. lib/kv.js), и к Blob почти не нужно обращаться.
import * as state from '../lib/routes/state.js';
import * as answer from '../lib/routes/answer.js';
import * as finish from '../lib/routes/finish.js';
import * as reset from '../lib/routes/reset.js';
import * as quest from '../lib/routes/quest.js';

const routes = { state, answer, finish, reset, quest };

async function handle(request, method) {
  const r = new URL(request.url).searchParams.get('r') || '';
  const handler = routes[r]?.[method];
  if (!handler) return Response.json({ error: 'Not found' }, { status: 404 });
  return handler(request);
}

export const GET = (req) => handle(req, 'GET');
export const POST = (req) => handle(req, 'POST');
