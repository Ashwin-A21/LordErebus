'use strict';
/**
 * Local preview without the Vercel CLI: serves the static site and runs /api/* functions.
 *   npm run dev   →  http://localhost:3000
 * Reads variables from .env (git-ignored).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = process.env.ENV_FILE || path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/api\/([a-z]+)$/);
  if (m) {
    const file = path.join(root, 'api', m[1] + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    req.query = Object.fromEntries(url.searchParams);
    if (!req.headers['x-real-ip']) req.headers['x-real-ip'] = req.socket.remoteAddress;
    return require(file)(req, res);
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname === '/admin' ? '/admin.html' : url.pathname;
  const fp = path.normalize(path.join(root, p));
  if (!fp.startsWith(root) || /node_modules|\.env|[\\/]lib[\\/]|[\\/]scripts[\\/]/.test(fp) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.statusCode = 404; return res.end('Not found');
  }
  res.setHeader('Content-Type', TYPES[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
}).listen(port, () => console.log(`Lord Erebus dev server → http://localhost:${port}`));
