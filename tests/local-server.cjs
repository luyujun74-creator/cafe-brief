const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../docs');
const port = Number(process.env.CB_PREVIEW_PORT || 8770);
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/api/status') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ configured: false, remaining: null, unlimited: false }));
  }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end(); }
    if (name === 'config.js') data = 'window.CB_CONFIG = { apiBase: "" };';
    if (name === 'index.html' && url.searchParams.has('cold')) {
      data = data.toString().replace(/(src|href)="(app.js|config.js|proto.css|tokens.css)(?:\?[^"]*)?"/g,
        (_, attribute, asset) => `${attribute}="${asset}?cold=${encodeURIComponent(url.searchParams.get('cold'))}"`);
    }
    res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-cache');
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Café Brief local preview http://127.0.0.1:${port}/`));
