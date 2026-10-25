import express, { type RequestHandler } from "express";
import { createGameSessionController } from "../controller/gameSession.controller.js";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import {
  gameSessionService,
  type GameSessionService,
} from "../services/gameSession.service.js";

export const createGameSessionRouter = (
  authentication: RequestHandler = protectedRoute,
  service: GameSessionService = gameSessionService,
) => {
  const router = express.Router();
  const controller = createGameSessionController(service);

  // Gắn xác thực theo từng route thay vì router.use: router này chỉ xử lý đúng các route của nó,
  // các router khác dùng chung prefix /game-sessions không bị xác thực thêm lần nữa
  router.post("/", authentication, controller.startRound);
  router.post("/:sessionId/recall", authentication, controller.startRecall);
  router.post("/:sessionId/submit", authentication, controller.submitRound);

  return router;
};

export default createGameSessionRouter();
