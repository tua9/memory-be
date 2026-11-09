import express from "express";
import { parentRoute, protectedRoute, verifiedParentRoute } from "../middlewares/authMiddleware.js";
import {
    childParentStatus, childRegisterParent, childResendParent,
    parentAgeGroup, parentGames, parentOverview, parentPassword, parentReport,
    validateParentEmail, verifyParentEmail,
} from "../controller/parent.controller.js";

const router = express.Router();
router.post("/verify/inspect", validateParentEmail);
router.post("/verify/confirm", verifyParentEmail);
router.get("/link", protectedRoute, childParentStatus);
router.post("/register", protectedRoute, childRegisterParent);
router.post("/resend", protectedRoute, childResendParent);
router.patch("/password", parentRoute, parentPassword);
router.get("/overview", verifiedParentRoute, parentOverview);
router.get("/games", verifiedParentRoute, parentGames);
router.get("/report", verifiedParentRoute, parentReport);
router.patch("/age-group", verifiedParentRoute, parentAgeGroup);
export default router;
