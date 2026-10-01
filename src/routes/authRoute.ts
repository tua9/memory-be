import express from "express";
import { refresh, signIn, signOut, signUp } from "../controller/auth.controller";

const router = express.Router();

router.post("/register", signUp);
router.post("/login", signIn);
router.post("/refresh", refresh);
router.post("/logout", signOut);

export default router;