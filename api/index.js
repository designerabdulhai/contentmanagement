const WORKER_URL = 'https://contentmanagement-api.rubel-bhd1.workers.dev';

function getRoute(req) {
  const rawRoute = req.query?.route;

  if (Array.isArray(rawRoute) && rawRoute.length) {
    return rawRoute
      .filter(Boolean)
      .join('/')
      .replace(/^\/+|\/+$/g, '');
  }

  if (typeof rawRoute === 'string' && rawRoute.trim()) {
    return rawRoute
      .trim()
      .replace(/^\/+|\/+$/g, '');
  }

  const rawUrl = String(req.url || '');
  const match = rawUrl.match(
    /\/api\/(.*?)(?:\?.*)?$/
  );

  return match?.[1]
    ? decodeURIComponent(match[1]).replace(
        /^\/+|\/+$/g,
        ''
      )
    : '';
}

function readBody(req) {
  if (req.body == null) return undefined;

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return req.body;
    }
  }

  return req.body;
}

async function handler(req, res) {
  let route = getRoute(req);

  const rawUrl = String(req.url || '');
  const queryIndex = rawUrl.indexOf('?');
  const query =
    queryIndex >= 0
      ? rawUrl.slice(queryIndex)
      : '';

  if (!route) {
    const originalUrl = String(
      req.headers?.['x-matched-path'] ||
        req.headers?.['x-original-url'] ||
        req.headers?.referer ||
        ''
    );

    const match = originalUrl.match(
      /\/api\/(.*?)(?:\?.*)?$/
    );

    if (match?.[1]) {
      route = decodeURIComponent(
        match[1]
      ).replace(
        /^\/+|\/+$/g,
        ''
      );
    }
  }

  if (!route) {
    return res.status(404).json({
      error: {
        code: '404',
        message:
          'API route not specified',
      },
    });
  }

  const target =
    `${WORKER_URL}/api/${route}${query}`;

  try {
    const headers = {
      Accept:
        req.headers?.accept ||
        'application/json',
    };

    if (req.headers?.['content-type']) {
      headers['Content-Type'] =
        req.headers['content-type'];
    }

    if (req.headers?.authorization) {
      headers.Authorization =
        req.headers.authorization;
    }

    const method = String(
      req.method || 'GET'
    ).toUpperCase();

    const init = {
      method,
      headers,
      redirect: 'follow',
    };

    if (
      !['GET', 'HEAD'].includes(method)
    ) {
      const body = readBody(req);

      if (
        body !== undefined &&
        body !== null &&
        body !== ''
      ) {
        init.body =
          typeof body === 'string'
            ? body
            : JSON.stringify(body);
      }
    }

    const upstream =
      await fetch(target, init);

    const text =
      await upstream.text();

    res.status(upstream.status);

    res.setHeader(
      'Content-Type',
      upstream.headers.get(
        'content-type'
      ) ||
        'application/json; charset=utf-8'
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res.end(text);
  } catch (error) {
    console.error(
      'API proxy error:',
      error
    );

    return res
      .status(502)
      .json({
        error: {
          code: '502',
          message:
            error?.message ||
            'Unable to reach Cloudflare Worker',
        },
      });
  }
}

export default handler;
