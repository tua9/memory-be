import express from "express";
import { createPasswordResetController } from "../controller/passwordReset.controller.js";
import { parentPasswordResetService } from "../services/passwordReset.service.js";

const router = express.Router();
const controller = createPasswordResetController(parentPasswordResetService);
router.post("/forgot", controller.forgotPassword);
router.post("/validate", controller.validateToken);
router.post("/confirm", controller.confirm);
export default router;
