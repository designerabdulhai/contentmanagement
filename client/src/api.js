import axios from 'axios';

// Normal API traffic stays on the same-origin Vercel proxy.
// Post deletion is routed directly to the live Cloudflare Worker so the
// delete action does not depend on the Vercel rewrite layer.
const baseURL = '/api';
const WORKER_URL = 'https://contentmanagement-api.rubel-bhd1.workers.dev';
const TOKEN_KEY = 'content_schedule_auth_token';

const api = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  // IMPORTANT: the Worker exposes the stable delete endpoint as
  // POST /api/posts/:id/delete. Do not convert it to DELETE here.
  // Calling the Worker directly also avoids the Vercel rewrite losing the
  // dynamic /posts/:id/delete route.
  const url = String(config.url || '');
  const deleteMatch = url.match(/^\/posts\/(\d+)\/delete$/);
  if (config.method?.toLowerCase() === 'post' && deleteMatch) {
    config.baseURL = WORKER_URL;
    config.method = 'post';
    config.url = `/api/posts/${deleteMatch[1]}/delete`;
  }

  return config;
});

function toMessage(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if (typeof value.error === 'string') return value.error;
    if (typeof value.message === 'string') return value.message;
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return String(value);
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = String(error.config?.url || '');

    if (!error.response) {
      return Promise.reject(
        new Error(`Failed to reach API: ${error.message || 'network error'}`)
      );
    }

    const message =
      toMessage(error.response.data) ||
      error.message ||
      `Request failed (${status})`;

    if (status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new CustomEvent('authExpired'));
    }

    return Promise.reject(new Error(message));
  }
);

export { TOKEN_KEY, baseURL };
export default api;
