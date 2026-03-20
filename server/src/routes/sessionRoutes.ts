import { Router } from "express";
import sessionController from "../controllers/sessionController";

const router = Router();

router.post("/", sessionController.create);
router.get("/:id", sessionController.getOne);
router.post("/:id/finalize", sessionController.finalize);
router.get("/:id/download/yaml", sessionController.downloadYaml);
router.get("/:id/download/guide", sessionController.downloadGuide);

export default router;