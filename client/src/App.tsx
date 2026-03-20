import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from 'react-hot-toast'

import Layout from "./components/layout/Layout";
import Conflicts from "./pages/Conflicts";
import Dashboard from "./pages/Dashboard";
import Repository from "./pages/Repository";
import Result from "./pages/Result";

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/repo/:repoId" element={<Repository />} />
          <Route path="/conflicts/:sessionId" element={<Conflicts />} />
          <Route path="/result/:sessionId" element={<Result />} />
        </Routes>
      </Layout>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#1e293b",
            color: "#f1f5f9",
            border: "1px solid #334155"
          },
          success: {
            iconTheme: {
              primary: "#22c55e",
              secondary: "#1e293b"
            }
          },
          error: {
            iconTheme: {
              primary: "#ef4444",
              secondary: "#1e293b"
            }
          }
        }}
      />
    </BrowserRouter>
  );
}

export default App;
