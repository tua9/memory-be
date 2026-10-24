import express from "express";
import authRoute from "./authRoute";
import profileRoute from "./profileRoute.js";
import gameSessionRoute from "./gameSessionRoute.js";
import gameHistoryRoute from "./gameHistoryRoute.js";

const router = express.Router();

router.get("/", (_request, response) => {
  response.json({ message: "Welcome to the API!" });
});

router.use("/auth", authRoute);
router.use("/profile", profileRoute);
router.use("/game-sessions", gameSessionRoute);
router.use("/game-sessions", gameHistoryRoute);
export default router;
