import express from "express";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import { createGameSessionController } from "../controller/gameSession.controller.js";
import type { GameSessionService } from "../services/gameSession.service.js";
import { gameSessionService } from "../services/gameSession.service.js";

export const createGameSessionRouter = (
	authentication: express.RequestHandler = protectedRoute,
	service: GameSessionService = gameSessionService,
) => {
	const router = express.Router();
	const controller = createGameSessionController(service);

	router.use(authentication);
	router.post("/", controller.createSession);
	router.get("/user/:userId", controller.getUserHistory);

	return router;
};

export default createGameSessionRouter();
