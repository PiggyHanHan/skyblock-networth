'use strict';

/**
 * 本地可视化服务：浏览器打开 http://127.0.0.1:5173 即可查询
 * API Key 只从 .env 读取，不下发到前端。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5173;
const CACHE_TTL = 60 * 1000;
const cache = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function runCli(args) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(ROOT, 'nw.js'), ...args],
      { cwd: ROOT, timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = String(stdout || '').trim();
        if (out.startsWith('{') || out.startsWith('[')) {
          try {
            return resolve(JSON.parse(out));
          } catch {
            /* 落到下面的错误处理 */
          }
        }
        const lines = String(stderr || '')
          .replace(/\x1b\[[0-9;]*m/g, '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const errLine = lines.filter((l) => l.startsWith('✖')).pop();
        const msg = (errLine ? errLine.replace(/^✖\s*/, '') : lines[lines.length - 1]) || '查询失败';
        reject(new Error(msg));
      },
    );
  });
}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.data;
  const data = await fn();
  cache.set(key, { t: Date.now(), data });
  return data;
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/profiles') {
      const player = (url.searchParams.get('player') || '').trim();
      if (!player) return sendJson(res, 400, { error: '缺少 player 参数' });
      const data = await cached(`p:${player.toLowerCase()}`, () => runCli([player, '--list', '--json']));
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/networth') {
      const player = (url.searchParams.get('player') || '').trim();
      if (!player) return sendJson(res, 400, { error: '缺少 player 参数' });
      const profile = (url.searchParams.get('profile') || '').trim();
      const museum = url.searchParams.get('museum') !== '0';
      const refresh = url.searchParams.get('refresh') === '1';
      const args = [player, '--json', '--top', '12'];
      if (profile) args.push('--profile', profile);
      if (!museum) args.push('--no-museum');
      const key = `n:${player.toLowerCase()}:${profile.toLowerCase()}:${museum}`;
      const data = refresh ? await runCli(args) : await cached(key, () => runCli(args));
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/items') {
      const player = (url.searchParams.get('player') || '').trim();
      if (!player) return sendJson(res, 400, { error: '缺少 player 参数' });
      const profile = (url.searchParams.get('profile') || '').trim();
      const refresh = url.searchParams.get('refresh') === '1';
      const args = [player, '--json', '--items', '--top', '0'];
      if (profile) args.push('--profile', profile);
      const key = `i:${player.toLowerCase()}:${profile.toLowerCase()}`;
      const data = refresh ? await runCli(args) : await cached(key, () => runCli(args));
      return sendJson(res, 200, data);
    }

    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: '未知接口' });

    return serveStatic(res, url.pathname);
  } catch (e) {
    return sendJson(res, 502, { error: e.message || '查询失败' });
  }
});

function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      listen(port + 1, attempt + 1);
      return;
    }
    console.error(`启动失败：${err.message}`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  SkyBlock Networth 已启动\n  http://127.0.0.1:${port}\n\n  按 Ctrl+C 停止\n`);
  });
}

listen(PORT);
