import express from "express";
import {
  createWordsSessionController,
  wordsSessionController,
} from "../controller/wordsSession.controller.js";
import type { WordsSessionService } from "../services/wordsSession.service.js";

export const createWordsSessionRouter = (service?: WordsSessionService) => {
  const router = express.Router();
  const controller = service ? createWordsSessionController(service) : wordsSessionController;

  router.get("/levels", controller.getLevels);

  // Hỗ trợ cả /sessions và /rounds
  router.post("/sessions", controller.createSession);
  router.post("/sessions/:sessionId/submit", controller.submitSession);
  router.post("/sessions/submit", controller.submitSession);

  router.post("/rounds", controller.createSession);
  router.post("/rounds/:sessionId/submit", controller.submitSession);
  router.post("/rounds/submit", controller.submitSession);

  return router;
};

export default createWordsSessionRouter();

