// Test fixture: a standalone OTLP/HTTP collector run as a CHILD PROCESS by the
// E2E test. Running it out-of-process isolates the real socket lifecycle from the
// test runner's `--test-force-exit` teardown (which otherwise trips a Windows
// libuv close assertion when a live in-process socket is force-closed).
//
// Protocol: on listen it prints `PORT <n>` to stdout. For every accepted export
// it prints `RECEIVED <json-line>` where json-line = { url, contentType,
// authHeader, body }. Exits on SIGTERM.
import { createServer } from 'node:http';

const received = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400).end('bad json');
      return;
    }
    const entry = {
      url: req.url,
      contentType: req.headers['content-type'] ?? null,
      authHeader: req.headers['authorization'] ?? null,
      body,
    };
    received.push(entry);
    process.stdout.write(`RECEIVED ${JSON.stringify(entry)}\n`);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`PORT ${server.address().port}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
