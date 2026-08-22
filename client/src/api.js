import axios from 'axios';

// Use VITE_API_URL in production, while keeping the local development default.
const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

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
