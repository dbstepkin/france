// Минимальный клиент Redis (Upstash REST) без зависимостей.
// Локально (вне Vercel) и без переменных — хранилище в памяти процесса.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DAY = 86400;

export const TTL = 14 * DAY;

export async function pipeline(cmds) {
  if (!cmds.length) return [];
  if (!URL_) {
    if (process.env.VERCEL) throw new Error('База не подключена: добавьте Upstash Redis к проекту в Vercel → Storage');
    return cmds.map(memCmd);
  }
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Redis ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error('Redis: ' + x.error);
    return x.result;
  });
}

export async function cmd(...args) {
  return (await pipeline([args]))[0];
}

export function toObj(flat) {
  const o = {};
  for (let i = 0; flat && i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
}

export function parse(s, fallback = null) {
  if (s == null) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// ---- память для локальной разработки ----
const mem = (globalThis.__kvMem ||= new Map());

function memCmd([name, key, ...a]) {
  const op = String(name).toUpperCase();
  const v = mem.get(key);
  switch (op) {
    case 'GET':
      return typeof v === 'string' ? v : null;
    case 'SET':
      mem.set(key, String(a[0]));
      return 'OK';
    case 'DEL': {
      let n = 0;
      for (const k of [key, ...a]) n += mem.delete(k) ? 1 : 0;
      return n;
    }
    case 'EXPIRE':
      return 1;
    case 'RPUSH': {
      const l = Array.isArray(v) ? v : [];
      l.push(...a.map(String));
      mem.set(key, l);
      return l.length;
    }
    case 'LLEN':
      return Array.isArray(v) ? v.length : 0;
    case 'LRANGE':
      return Array.isArray(v) ? v.slice() : [];
    case 'HSET': {
      const h = v instanceof Map ? v : new Map();
      for (let i = 0; i < a.length; i += 2) h.set(String(a[i]), String(a[i + 1]));
      mem.set(key, h);
      return 1;
    }
    case 'HGET':
      return v instanceof Map ? (v.get(String(a[0])) ?? null) : null;
    case 'HLEN':
      return v instanceof Map ? v.size : 0;
    case 'HGETALL':
      return v instanceof Map ? [...v.entries()].flat() : [];
    case 'HVALS':
      return v instanceof Map ? [...v.values()] : [];
    default:
      throw new Error('mem: unsupported ' + op);
  }
}
