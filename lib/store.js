// Хранилище опроса поверх Vercel Blob.
// Каждый ответ — отдельный blob, а сами слова закодированы прямо в имени файла,
// поэтому всё состояние читается одним list(). Без токена (локально) — память процесса.
import { put, list, del } from '@vercel/blob';

const PREFIX = 'fr/';
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const mem = (globalThis.__frMem ||= new Map());
const cache = (globalThis.__frCache ||= { snap: null, at: 0, results: new Map() });

async function listAll() {
  if (!useBlob) return [...mem.keys()].map((pathname) => ({ pathname, url: 'mem:' + pathname }));
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: PREFIX, limit: 1000, cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

async function write(pathname, body) {
  if (!useBlob) {
    mem.set(pathname, body);
    return;
  }
  await put(pathname, body, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export function invalidate() {
  cache.snap = null;
}

// { pollId, answers: string[][], resultBlob }
export async function snapshot(maxAgeMs = 1500) {
  if (cache.snap && Date.now() - cache.at < maxAgeMs) return cache.snap;
  const blobs = await listAll();
  const answers = [];
  let pollId = '0';
  let resultBlob = null;
  for (const b of blobs) {
    const rest = b.pathname.slice(PREFIX.length);
    if (rest.startsWith('a/')) {
      try {
        const enc = rest.slice(rest.lastIndexOf('.') + 1);
        const words = JSON.parse(Buffer.from(enc, 'base64url').toString('utf8'));
        if (Array.isArray(words)) answers.push(words);
      } catch {}
    } else if (rest.startsWith('r/')) {
      if (!resultBlob || b.pathname > resultBlob.pathname) resultBlob = b;
    } else if (rest.startsWith('p/')) {
      const id = rest.slice(2);
      if (id > pollId) pollId = id;
    }
  }
  cache.snap = { pollId, answers, resultBlob };
  cache.at = Date.now();
  return cache.snap;
}

export async function addAnswer(words) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const enc = Buffer.from(JSON.stringify(words), 'utf8').toString('base64url');
  await write(`${PREFIX}a/${id}.${enc}`, '1');
  invalidate();
}

export async function readResult(resultBlob) {
  if (!resultBlob) return null;
  if (cache.results.has(resultBlob.pathname)) return cache.results.get(resultBlob.pathname);
  let data;
  if (!useBlob) data = JSON.parse(mem.get(resultBlob.pathname));
  else data = await (await fetch(resultBlob.url, { cache: 'no-store' })).json();
  cache.results.set(resultBlob.pathname, data);
  return data;
}

export async function saveResult(data) {
  const pathname = `${PREFIX}r/${Date.now()}.json`;
  await write(pathname, JSON.stringify(data));
  cache.results.set(pathname, data);
  invalidate();
}

export async function resetAll() {
  const blobs = await listAll();
  if (!useBlob) mem.clear();
  else if (blobs.length) {
    for (let i = 0; i < blobs.length; i += 500) await del(blobs.slice(i, i + 500).map((b) => b.url));
  }
  cache.results.clear();
  await write(`${PREFIX}p/${Date.now()}`, '1');
  invalidate();
}
