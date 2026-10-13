import express from "express";
import { gameSessionController } from "../controller/gameSession.controller.js";

const router = express.Router();

router.post("/", gameSessionController.createSession);
router.get("/user/:userId", gameSessionController.getUserHistory);

export default router;
