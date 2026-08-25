const WORKER_API = 'https://contentmanagement-api.rubel-bhd1.workers.dev';

function getTail(req) {
  const value = req?.query?.path;

  if (Array.isArray(value)) {
    return value.filter(Boolean).join('/');
  }

  if (typeof value === 'string' && value) {
    return value.replace(/^\/+|\/+$/g, '');
  }

  const url = String(req?.url || '');
  const pathname = url.split('?')[0].replace(/^\/+|\/+$/g, '');

  if (pathname === 'api') return '';
  if (pathname.startsWith('api/')) return pathname.slice(4);

  return '';
}

function getQuery(req) {
  const url = String(req?.url || '');
  const index = url.indexOf('?');
  return index >= 0 ? url.slice(index) : '';
}

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length ? Buffer.concat(chunks) : undefined;
}

module.exports = async function handler(req, res) {
  const tail = getTail(req);

  if (!tail) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({
      ok: true,
      proxy: 'vercel',
      upstream: WORKER_API,
    }));
    return;
  }

  const target = `${WORKER_API}/api/${tail}${getQuery(req)}`;

  try {
    const headers = {};

    for (const [key, value] of Object.entries(req.headers || {})) {
      const lower = key.toLowerCase();
      if (lower === 'host' || lower === 'content-length') continue;
      if (value != null) headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }

    const init = {
      method: req.method || 'GET',
      headers,
      redirect: 'follow',
    };

    if (!['GET', 'HEAD'].includes(init.method)) {
      init.body = await readBody(req);
    }

    const upstream = await fetch(target, init);
    const text = await upstream.text();

    res.statusCode = upstream.status;
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json; charset=utf-8'
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
  } catch (error) {
    console.error('Cloudflare proxy error:', error);

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({
      error: 'Cloudflare API proxy failed',
      details: error?.message || String(error),
    }));
  }
};
