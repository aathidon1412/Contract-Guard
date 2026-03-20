import { Router } from "express";
import conflictController from "../controllers/conflictController";

const router = Router();

router.get("/", conflictController.getBySession);
router.patch("/:id/resolve", conflictController.resolveOne);
router.post("/bulk-resolve", conflictController.resolveAll);

export default router;