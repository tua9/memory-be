import express, { type RequestHandler } from "express";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import { createPasswordResetController } from "../controller/passwordReset.controller.js";
import {
    passwordResetService,
    type PasswordResetService,
} from "../services/passwordReset.service.js";

// Không đặt dưới /auth: client chỉ tự refresh phiên khi gọi API ngoài /auth, mà API gửi link cần điều đó
export const createPasswordResetRouter = (
    authentication: RequestHandler = protectedRoute,
    service: PasswordResetService = passwordResetService,
) => {
    const router = express.Router();
    const controller = createPasswordResetController(service);

    // Cần đăng nhập: gửi link tới email của chính người đang đăng nhập
    router.post("/request", authentication, controller.requestLink);
    // Công khai: người mở link có thể chưa đăng nhập; quyền do token trong email quyết định
    router.post("/validate", controller.validateToken);
    router.post("/confirm", controller.confirm);

    return router;
};

export default createPasswordResetRouter();

