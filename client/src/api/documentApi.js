import axios from "axios";

const BASE_URL = "http://localhost:5000/api/documents";

export const uploadAndProcess = async (files) => {
  const formData = new FormData();
  files.forEach(f => formData.append("pdfs", f));

  const { data } = await axios.post(`${BASE_URL}/process`, formData, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return data;
};
