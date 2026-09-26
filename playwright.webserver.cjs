const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'apps', 'cast', 'out', 'renderer');
const port = Number(process.env.E2E_PORT || '4173');

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function resolveRequestPath(urlPathname) {
  if (!urlPathname || urlPathname === '/') {
    return path.join(root, 'index.html');
  }

  const pathname = decodeURIComponent(urlPathname.split('?')[0]);
  const candidate = path.normalize(path.join(root, pathname));

  if (!candidate.startsWith(root)) {
    return null;
  }

  return candidate;
}

const server = http.createServer((request, response) => {
  const filePath = resolveRequestPath(request.url || '/');

  if (!filePath) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes.get(path.extname(filePath)) || 'application/octet-stream',
    });
    response.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Static preview listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
