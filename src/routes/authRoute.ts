import express from "express";
import { googleAuth, refresh, signIn, signOut, signUp } from "../controller/auth.controller";

const router = express.Router();

router.post("/register", signUp);
router.post("/login", signIn);
router.post("/refresh", refresh);
router.post("/logout", signOut);
router.post("/google", googleAuth);
// Đặt / đổi mật khẩu nằm ở PATCH /profile/password: ngoài /auth nên client tự refresh phiên khi access token hết hạn

export default router;
