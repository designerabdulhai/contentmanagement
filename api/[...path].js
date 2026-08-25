const WORKER_API = 'https://contentmanagement-api.rubel-bhd1.workers.dev';

module.exports = async function handler(req, res) {
  const tail = Array.isArray(req.query.path)
    ? req.query.path.join('/')
    : String(req.query.path || '');

  const target = `${WORKER_API}/api/${tail}`;

  try {
    const headers = {};

    for (const [key, value] of Object.entries(req.headers || {})) {
      if (key.toLowerCase() === 'host') continue;
      if (key.toLowerCase() === 'content-length') continue;
      if (value != null) headers[key] = value;
    }

    const init = {
      method: req.method,
      headers,
      redirect: 'follow',
    };

    if (!['GET', 'HEAD'].includes(req.method)) {
      const chunks = [];

      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      init.body = Buffer.concat(chunks);
    }

    const upstream = await fetch(target, init);
    const text = await upstream.text();

    res.statusCode = upstream.status;

    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
  } catch (error) {
    console.error('Cloudflare proxy error:', error);

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'Cloudflare API proxy failed',
        details: error?.message || String(error),
      })
    );
  }
};
