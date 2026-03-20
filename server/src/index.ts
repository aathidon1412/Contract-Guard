import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import aiRoutes from "./routes/aiRoutes";
import branchRoutes from "./routes/branchRoutes";
import conflictRoutes from "./routes/conflictRoutes";
import repoRoutes from "./routes/repoRoutes";
import sessionRoutes from "./routes/sessionRoutes";
import { errorHandler } from "./middleware/errorHandler";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/repos", repoRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/conflicts", conflictRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/ai", aiRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log("ContractGuard Server running on port 5000");
});

export default app;