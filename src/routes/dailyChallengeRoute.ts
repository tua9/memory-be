import express, { type RequestHandler } from "express";
import { createDailyChallengeController } from "../controller/dailyChallenge.controller.js";
import { optionalAuthentication, protectedRoute } from "../middlewares/authMiddleware.js";
import {
  dailyChallengeService,
  type DailyChallengeService,
} from "../services/dailyChallenge.service.js";

// Khách xem được thử thách và bảng xếp hạng; chỉ người đã đăng nhập mới chơi được để vào bảng xếp hạng
export const createDailyChallengeRouter = (
  viewerAuthentication: RequestHandler = optionalAuthentication,
  playerAuthentication: RequestHandler = protectedRoute,
  service: DailyChallengeService = dailyChallengeService,
) => {
  const router = express.Router();
  const controller = createDailyChallengeController(service);

  router.get("/", viewerAuthentication, controller.getChallenge);
  router.post("/start", playerAuthentication, controller.startChallenge);

  return router;
};

export default createDailyChallengeRouter();
