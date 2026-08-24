import axios from 'axios';

// Cloudflare Worker is the production API. Accept either the Worker root URL
// or a URL that already ends with /api, so a Vercel VITE_API_URL typo cannot
// turn /auth/login into a 404 at the Worker root.
const configuredURL = String(import.meta.env.VITE_API_URL || 'https://contentmanagement-api.rubel-bhd1.workers.dev').replace(/\/+$/, '');
const baseURL = configuredURL.endsWith('/api') ? configuredURL : `${configuredURL}/api`;
const TOKEN_KEY = 'content_schedule_auth_token';

const api = axios.create({
  baseURL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.error || error.message || 'Request failed';
    if (status === 404 && String(error.config?.url || '').includes('/auth/login')) {
      return Promise.reject(new Error('Login API not found. Please deploy the latest Cloudflare Worker.'));
    }
    if (status === 401 && !String(error.config?.url || '').includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new CustomEvent('authExpired'));
    }
    return Promise.reject(new Error(message));
  }
);

export { TOKEN_KEY, baseURL };
export default api;
