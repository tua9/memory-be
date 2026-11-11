import express from "express";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import { codeEntryIpLimiter } from "../middlewares/rateLimit.js";
import {
    cancelMatch, createRoom, findMatch, findRoomPlayer, finishRoom, joinRoom, kickPlayer, leaderboard, leaveRoom, nextRoom, readRoom,
    pollMatch, readyRoom, recallRoom, rematchRoom, roomStats, startRoom, submitRoom,
} from "../controller/gameRoom.controller.js";

const router = express.Router();
router.use(protectedRoute);
router.post("/", createRoom);
router.get("/stats", roomStats);
router.get("/leaderboard", leaderboard);
// Ghép trận tự động: đặt trước "/:code" để "matchmaking" không bị hiểu là mã phòng
router.post("/matchmaking", findMatch);
router.get("/matchmaking", pollMatch);
router.delete("/matchmaking", cancelMatch);
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
// Chủ phòng tìm một người chơi ngẫu nhiên vào phòng của mình
router.post("/:code/find-player", findRoomPlayer);
export default router;
