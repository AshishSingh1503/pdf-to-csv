// client/src/api/apiClient.js
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : 'http://localhost:5000/api';

export const apiClient = axios.create({
  baseURL: BASE_URL,
});
