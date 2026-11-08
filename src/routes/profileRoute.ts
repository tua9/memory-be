import express, { type RequestHandler } from "express";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import { createUserProfileController } from "../controller/profile.controller.js";
import { changePassword } from "../controller/auth.controller.js";
import type { UserProfileService } from "../services/profile.service.js";
import { userProfileService } from "../services/profile.service.js";

export const createUserProfileRouter = (
    authentication: RequestHandler = protectedRoute,
    service: UserProfileService = userProfileService,
) => {
    const router = express.Router();
    const controller = createUserProfileController(service);

    router.use(authentication);
    router.get("/", controller.getProfile);
    router.patch("/", controller.updateProfile);
    router.put("/preferences", controller.savePreferences);
    router.post("/preferences/skip", controller.skipPreferences);
    router.patch("/password", changePassword);

    return router;
};

export default createUserProfileRouter();