import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api/documents` : "http://localhost:5000/api/documents";

export const uploadAndProcess = async (files, collectionId) => {
  const formData = new FormData();
  files.forEach(f => formData.append("pdfs", f));
  formData.append("collectionId", collectionId);

  const { data } = await axios.post(`${BASE_URL}/process`, formData, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return data;
};
