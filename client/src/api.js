import axios from 'axios';

// Cloudflare Worker is the production API. Set VITE_API_URL in Vercel to:
// https://contentmanagement-api.rubel-bhd1.workers.dev/api
const baseURL = import.meta.env.VITE_API_URL || 'https://contentmanagement-api.rubel-bhd1.workers.dev/api';
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
    const message = error.response?.data?.error || error.message || 'Request failed';
    if (error.response?.status === 401 && !String(error.config?.url || '').includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new CustomEvent('authExpired'));
    }
    return Promise.reject(new Error(message));
  }
);

export { TOKEN_KEY };
export default api;
