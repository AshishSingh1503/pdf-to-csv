import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api/documents` : "http://localhost:5000/api/documents";

export const uploadAndProcess = async (files, collectionId, onUploadProgress) => {
  const formData = new FormData();
  files.forEach(f => formData.append("pdfs", f));
  formData.append("collectionId", collectionId);

  const { data } = await axios.post(`${BASE_URL}/process`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress,
  });
  return data;
};

export const getUploadedFiles = async (collectionId) => {
  const { data } = await axios.get(`${BASE_URL}/files/collection/${collectionId}`);
  return data.data;
};

export const reprocessFile = async (fileId) => {
  const { data } = await axios.post(`${BASE_URL}/reprocess/${fileId}`);
  return data;
};

export const updateUploadProgress = async (fileId, progress) => {
  const { data } = await axios.post(`${BASE_URL}/upload/progress/${fileId}`, { progress });
  return data;
};
