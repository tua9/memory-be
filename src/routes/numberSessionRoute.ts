import express, { type RequestHandler } from "express";
import {
    createNumberSessionController,
    numberSessionController,
} from "../controller/numberSession.controller.js";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import {
    numberSessionService,
    type NumberSessionService,
} from "../services/numberSession.service.js";

export const createNumberSessionRouter = (
    authentication: RequestHandler = protectedRoute,
    service: NumberSessionService = numberSessionService,
) => {
    const router = express.Router();
    const controller = createNumberSessionController(service);

    router.use(authentication);

    // Static routes first
    router.post("/sessions", controller.createSession);
    router.get("/sessions", controller.getHistory);

    // Dynamic routes
    router.get("/sessions/:id", controller.getSession);
    router.post("/sessions/:id/recall", controller.startRecall);
    router.put("/sessions/:id/answers", controller.saveAnswers);
    router.post("/sessions/:id/submit", controller.submitSession);
    router.get("/sessions/:id/result", controller.getResult);

    return router;
};

export default createNumberSessionRouter();
