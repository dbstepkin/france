// Хранилище «как Redis» для одной функции Vercel:
//  - данные живут в памяти функции (все запросы обслуживает один процесс — api/main.js);
//  - каждое изменение дописывается в журнал в Vercel Blob (одна запись на запрос);
//  - раз в SYNC_MS функция перечитывает список журнала и, если появились чужие записи
//    (вторая копия функции) или процесс только запустился, заново проигрывает журнал.
// Так обращений к Blob — единицы в минуту, а не на каждый опрос телефона.
// Локально (без BLOB_*) — просто память процесса.
import { put, list } from '@vercel/blob';

const USE_BLOB = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const PREFIX = process.env.KV_PREFIX || 'kv/'; // KV_PREFIX — только для тестов
const SYNC_MS = 8000;
const INLINE_MAX = 600; // короткие записи кодируем прямо в имени файла — без чтения содержимого

export const TTL = 14 * 86400; // совместимость; в памяти не используется

const WRITE_OPS = new Set(['SET', 'DEL', 'RPUSH', 'HSET']);
const g = (globalThis.__kvBlob ||= { log: new Map(), pending: new Set(), lastSync: 0, syncing: null, seq: 0 });

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

function replay() {
  mem.clear();
  for (const name of [...g.log.keys()].sort()) for (const c of g.log.get(name)) memCmd(c);
}

async function listAll() {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: PREFIX, limit: 1000, cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

async function doSync() {
  const blobs = await listAll();
  const fresh = blobs.filter((b) => !g.log.has(b.pathname) && !g.pending.has(b.pathname));
  if (fresh.length) {
    await Promise.all(
      fresh.map(async (b) => {
        const rest = b.pathname.slice(PREFIX.length);
        const enc = rest.slice(rest.indexOf('.') + 1);
        let cmds;
        if (enc && enc !== 'json') cmds = JSON.parse(unb64(enc));
        else cmds = await (await fetch(b.url, { cache: 'no-store' })).json();
        g.log.set(b.pathname, cmds);
      }),
    );
    replay();
  }
  g.lastSync = Date.now();
}

async function ensureSynced(force) {
  if (!USE_BLOB) return;
  if (!force && Date.now() - g.lastSync < SYNC_MS) return;
  g.syncing ||= doSync().finally(() => (g.syncing = null));
  await g.syncing;
}

export async function sync() {
  await ensureSynced(true);
}

// Пишет запись журнала; применять её к памяти должен вызывающий — синхронно вместе с g.log.set,
// чтобы параллельная сверка не проиграла её второй раз.
async function putLog(cmds) {
  const json = JSON.stringify(cmds);
  const id = String(Date.now()).padStart(14, '0') + '-' + String(++g.seq).padStart(6, '0') + Math.random().toString(36).slice(2, 8);
  const enc = b64(json);
  const pathname = enc.length <= INLINE_MAX ? `${PREFIX}${id}.${enc}` : `${PREFIX}${id}.json`;
  g.pending.add(pathname);
  try {
    await put(pathname, enc.length <= INLINE_MAX ? '1' : json, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
  } catch (e) {
    g.pending.delete(pathname);
    throw e;
  }
  return pathname;
}

export async function pipeline(cmds) {
  if (!cmds.length) return [];
  cmds = cmds.map((c) => c.map(String));
  await ensureSynced(false);
  const writes = cmds.filter((c) => WRITE_OPS.has(c[0].toUpperCase()));
  if (writes.length && USE_BLOB) {
    const pathname = await putLog(writes);
    g.pending.delete(pathname);
    g.log.set(pathname, writes); // дальше — синхронно: запись в журнал и применение к памяти неразделимы
  }
  return cmds.map(memCmd);
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

// ---- данные в памяти (Redis-подобные команды) ----
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
