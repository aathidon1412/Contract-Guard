import axios from "axios";

const axiosClient = axios.create({
  baseURL: "http://localhost:5000/api",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

axiosClient.interceptors.request.use(
  (config) => {
    console.log("Request:", {
      method: config.method,
      url: config.url,
      baseURL: config.baseURL,
    });
    return config;
  },
  (error) => Promise.reject(error)
);

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      console.error("Cannot connect to server");
      return Promise.reject(new Error("Cannot connect to server"));
    }

    if (error.response.status === 500) {
      console.error("Server error");
      return Promise.reject(new Error("Server error"));
    }

    if (error.response.status === 404) {
      console.error("Not found");
      return Promise.reject(new Error("Not found"));
    }

    return Promise.reject(error);
  }
);

export default axiosClient;