import { Router } from "express";
import repoController from "../controllers/repoController";

const router = Router();

router.get("/", repoController.getAll);
router.post("/", repoController.addRepo);
router.get("/:id", repoController.getOne);
router.delete("/:id", repoController.deleteRepo);
router.post("/:id/scan", repoController.scanRepo);

export default router;