const WORKER_URL = 'https://contentmanagement-api.rubel-bhd1.workers.dev';

function getRoute(req) {
  const rawRoute = req.query?.route;
  if (Array.isArray(rawRoute) && rawRoute.length) {
    return rawRoute.filter(Boolean).join('/').replace(/^\/+|\/+$/g, '');
  }
  if (typeof rawRoute === 'string' && rawRoute.trim()) {
    return rawRoute.replace(/^\/+|\/+$/g, '');
  }

  const rawUrl = String(req.url || '');
  const match = rawUrl.match(/\/api\/(.*?)(?:\?.*)?$/);
  if (match?.[1]) {
    return decodeURIComponent(match[1]).replace(/^\/+|\/+$/g, '');
  }

  return '';
}

function readBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return req.body; }
  }
  return req.body;
}

export default async function handler(req, res) {
  const route = getRoute(req);
  const rawUrl = String(req.url || '');
  const queryIndex = rawUrl.indexOf('?');
  const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : '';

  if (!route) {
    return res.status(404).json({
      error: { code: '404', message: 'API route not specified' },
    });
  }

  const target = `${WORKER_URL}/api/${route}${query}`;

  try {
    const headers = {
      Accept: req.headers.accept || 'application/json',
    };

    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }

    // Preserve the user's auth token for protected D1 routes.
    if (req.headers.authorization) {
      headers.Authorization = req.headers.authorization;
    }

    const init = {
      method: req.method,
      headers,
      redirect: 'follow',
    };

    // Vercel may expose body as an object. Always serialize JSON for
    // write requests, including DELETE, so the upstream request is valid.
    if (!['GET', 'HEAD'].includes(req.method)) {
      const body = readBody(req);
      if (body !== undefined && body !== null && body !== '') {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
    }

    const upstream = await fetch(target, init);
    const text = await upstream.text();

    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json; charset=utf-8'
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.end(text);
  } catch (error) {
    console.error('API proxy error:', error);
    return res.status(502).json({
      error: {
        code: '502',
        message: error?.message || 'Unable to reach Cloudflare Worker',
      },
    });
  }
}
