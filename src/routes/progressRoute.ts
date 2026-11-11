import express, { type RequestHandler } from "express";
import { createProgressController } from "../controller/progress.controller.js";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import { coachChatIpLimiter } from "../middlewares/rateLimit.js";
import { progressService, type ProgressService } from "../services/progress.service.js";

export const createProgressRouter = (
    authentication: RequestHandler = protectedRoute,
    service: ProgressService = progressService,
) => {
    const router = express.Router();
    const controller = createProgressController(service);

    router.get("/timeline", authentication, controller.getTimeline);
    router.get("/coach", authentication, controller.getCoach);
    router.post("/coach/chat", authentication, coachChatIpLimiter, controller.chat);
    router.post("/coach/plan/generate", authentication, coachChatIpLimiter, controller.generateCoachPlan);
    router.get("/coach/plan", authentication, controller.getCoachPlan);
    router.put("/coach/plan", authentication, controller.saveCoachPlan);

    return router;
};

export default createProgressRouter();
