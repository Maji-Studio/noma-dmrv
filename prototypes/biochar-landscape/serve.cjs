// Throwaway static preview. No app server, authentication, database or dependencies.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const PORT = 3190;
http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname !== '/' && pathname !== '/index.html') {
    response.writeHead(404); response.end('Not found'); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(fs.readFileSync(path.join(__dirname, 'index.html')));
}).listen(PORT, '127.0.0.1', () => console.log(`Prototype: http://localhost:${PORT}`));
