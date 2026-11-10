import express from "express";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import { codeEntryIpLimiter } from "../middlewares/rateLimit.js";
import {
    createRoom, finishRoom, joinRoom, kickPlayer, leaderboard, leaveRoom, nextRoom, readRoom,
    readyRoom, recallRoom, rematchRoom, roomStats, startRoom, submitRoom,
} from "../controller/gameRoom.controller.js";

const router = express.Router();
router.use(protectedRoute);
router.post("/", createRoom);
router.get("/stats", roomStats);
router.get("/leaderboard", leaderboard);
router.get("/:code", readRoom);
router.post("/:code/join", codeEntryIpLimiter, joinRoom);
router.post("/:code/leave", leaveRoom);
router.post("/:code/kick", kickPlayer);
router.post("/:code/ready", readyRoom);
router.post("/:code/start", startRoom);
router.post("/:code/recall", recallRoom);
router.post("/:code/submit", submitRoom);
router.post("/:code/next", nextRoom);
router.post("/:code/finish", finishRoom);
router.post("/:code/rematch", rematchRoom);
export default router;
