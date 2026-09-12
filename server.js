const http = require('http');
const fs = require('fs');
const path = require('path');

// Parse CLI args: --port 7100 --host 0.0.0.0 (also supports PORT env)
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const port = parseInt(argVal('--port', process.env.PORT || '7100'), 10);
const host = argVal('--host', '0.0.0.0');
const root = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  let urlPath = decodeURIComponent(u.pathname);

  /* ---------- 写入 API ---------- */
  // 探测接口：页面用它判断当前是否是可写的本地服务器
  if (req.method === 'GET' && urlPath === '/api/save-data') {
    json(res, 200, { ok: true, rw: true }); return;
  }

  if (req.method === 'POST' && urlPath === '/api/save-data') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const txt = Buffer.concat(chunks).toString('utf8');
        JSON.parse(txt); // 校验合法 JSON
        fs.writeFileSync(path.join(root, 'data.json'), txt);
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { ok: false, error: String(e) }); }
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/upload') {
    const dir = u.searchParams.get('dir');
    const name = path.basename(u.searchParams.get('name') || '');
    if (!['videos', 'posters', 'images'].includes(dir) || !/^[A-Za-z0-9_.-]+$/.test(name)) {
      json(res, 400, { ok: false, error: 'bad dir/name' }); return;
    }
    const ws = fs.createWriteStream(path.join(root, dir, name));
    req.pipe(ws);
    ws.on('finish', () => json(res, 200, { ok: true, url: './' + dir + '/' + name }));
    ws.on('error', e => json(res, 500, { ok: false, error: String(e) }));
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/delete-file') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const p = JSON.parse(Buffer.concat(chunks).toString('utf8')).path || '';
        // 只允许删除上传生成的文件，内置素材不可删
        if (!/^\.\/(videos|images|posters)\/upload_[A-Za-z0-9_.-]+$/.test(p)) {
          json(res, 403, { ok: false }); return;
        }
        fs.unlink(path.join(root, p.replace(/^\.\//, '')), () => json(res, 200, { ok: true }));
      } catch (e) { json(res, 400, { ok: false }); }
    });
    return;
  }

  /* ---------- 静态文件 ---------- */
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(root, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes'
    };
    // html / json 不缓存，保证每次打开都是最新内容
    if (ext === '.html' || ext === '.json') headers['Cache-Control'] = 'no-store';

    // Support HTTP Range so <video> scrubbing works
    if (range && ext === '.mp4') {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      if (start > end) { res.writeHead(416); res.end(); return; }
      res.writeHead(206, Object.assign(headers, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1
      }));
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      headers['Content-Length'] = stat.size;
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

server.listen(port, host, () => {
  console.log(`portfolio-v2 dev server: http://${host}:${port}/`);
});
