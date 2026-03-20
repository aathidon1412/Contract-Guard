import { BrowserRouter, Route, Routes } from "react-router-dom";

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
    </BrowserRouter>
  );
}

export default App;
