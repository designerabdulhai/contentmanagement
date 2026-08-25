const WORKER_API = 'https://contentmanagement-api.rubel-bhd1.workers.dev';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const body = req.body || {};

    const upstream = await fetch(`${WORKER_API}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        email: body.email,
        password: body.password,
      }),
      redirect: 'follow',
    });

    const text = await upstream.text();

    res.statusCode = upstream.status;
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json; charset=utf-8'
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
  } catch (error) {
    console.error('Login proxy error:', error);
    res.status(502).json({
      error: 'Cloudflare API proxy failed',
      details: error?.message || String(error),
    });
  }
};
