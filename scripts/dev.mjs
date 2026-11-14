// Локальный запуск без Vercel: node scripts/dev.mjs  ->  http://localhost:3000
// Ответы хранятся в памяти процесса (если нет BLOB_READ_WRITE_TOKEN).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 3000);

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname.startsWith('/api/')) {
        const file = path.join(root, 'api', url.pathname.slice(5) + '.js');
        const mod = await import(pathToFileURL(file).href);
        const handler = mod[req.method];
        if (!handler) return res.writeHead(405).end();
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        });
        const r = await handler(request);
        res.writeHead(r.status, Object.fromEntries(r.headers));
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      if (!path.extname(p)) {
        const dir = path.join(root, 'public', p);
        p = fs.existsSync(path.join(dir, 'index.html')) ? p.replace(/\/$/, '') + '/index.html' : p + '.html';
      }
      const file = path.join(root, 'public', p);
      if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      console.error(e);
      res.writeHead(500).end(String(e));
    }
  })
  .listen(port, () => console.log(`http://localhost:${port}`));
