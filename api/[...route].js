const WORKER_URL = 'https://contentmanagement-api.rubel-bhd1.workers.dev';

export default async function handler(req, res) {
  const route = Array.isArray(req.query?.route)
    ? req.query.route.join('/')
    : String(req.query?.route || '');

  const target = `${WORKER_URL}/api/${route}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;

  try {
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
    };

    if (req.headers.authorization) {
      headers.Authorization = req.headers.authorization;
    }

    const init = {
      method: req.method,
      headers,
    };

    if (!['GET', 'HEAD'].includes(req.method)) {
      init.body = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});
    }

    const response = await fetch(target, init);
    const text = await response.text();

    res.status(response.status);
    res.setHeader(
      'Content-Type',
      response.headers.get('content-type') || 'application/json; charset=utf-8'
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
