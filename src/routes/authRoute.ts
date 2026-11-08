import express from "express";
import { changePassword, refresh, signIn, signOut, signUp } from "../controller/auth.controller";
import { protectedRoute } from "../middlewares/authMiddleware";

const router = express.Router();

router.post("/register", signUp);
router.post("/login", signIn);
router.post("/refresh", refresh);
router.post("/logout", signOut);
router.patch("/change-password", protectedRoute, changePassword);

export default router;