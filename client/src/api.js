import axios from 'axios';

// Same-origin /api works automatically when the React build is served by Express.
// Set VITE_API_URL only when the API is hosted on a separate domain/subdomain.
const baseURL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.error || error.message || 'Request failed';
    return Promise.reject(new Error(message));
  }
);

export default api;
