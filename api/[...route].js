const WORKER_URL = 'https://contentmanagement-api.rubel-bhd1.workers.dev';

function getRoute(req) {
  const url = String(req.url || '');

  // Vercel catch-all query param is normally provided as req.query.route.
  // Prefer it, but fall back to the original request URL when absent.
  const raw = req.query?.route;
  if (Array.isArray(raw) && raw.length) {
    return raw.filter(Boolean).join('/').replace(/^\/+|\/+$/g, '');
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.replace(/^\/+|\/+$/g, '');
  }

  const match = url.match(/\/api\/(.*?)(?:\?.*)?$/);
  return match?.[1]
    ? decodeURIComponent(match[1]).replace(/^\/+|\/+$/g, '')
    : '';
}

export default async function handler(req, res) {
  const route = getRoute(req);
  const rawUrl = String(req.url || '');
  const queryIndex = rawUrl.indexOf('?');
  const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : '';
  const target = `${WORKER_URL}/api/${route}${query}`;

  try {
    const headers = {
      Accept: req.headers.accept || 'application/json',
    };

    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }

    // Preserve the logged-in user's bearer token.
    if (req.headers.authorization) {
      headers.Authorization = req.headers.authorization;
    }

    const init = {
      method: req.method,
      headers,
      redirect: 'follow',
    };

    if (!['GET', 'HEAD'].includes(req.method)) {
      init.body = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});
    }

    const upstream = await fetch(target, init);
    const text = await upstream.text();

    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json; charset=utf-8'
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(text);
  } catch (error) {
    console.error('API proxy error:', error);
    res.status(502).json({
      error: {
        code: '502',
        message: error?.message || 'Unable to reach Cloudflare Worker',
      },
    });
  }
}
