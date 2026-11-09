import express from "express";
import { roomParticipantRoute, verifiedParentRoute } from "../middlewares/authMiddleware.js";
import {
    createRoom, finishRoom, joinRoom, nextRoom, parentPoints, readRoom,
    readyRoom, recallRoom, startRoom, submitRoom,
} from "../controller/familyRoom.controller.js";

const router = express.Router();
router.post("/", verifiedParentRoute, createRoom);
router.get("/points", verifiedParentRoute, parentPoints);
router.get("/:code", roomParticipantRoute, readRoom);
router.post("/:code/join", roomParticipantRoute, joinRoom);
router.post("/:code/ready", roomParticipantRoute, readyRoom);
router.post("/:code/start", roomParticipantRoute, startRoom);
router.post("/:code/recall", roomParticipantRoute, recallRoom);
router.post("/:code/submit", roomParticipantRoute, submitRoom);
router.post("/:code/next", roomParticipantRoute, nextRoom);
router.post("/:code/finish", roomParticipantRoute, finishRoom);
export default router;
