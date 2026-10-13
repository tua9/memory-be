import express from "express";
import authRoute from "./authRoute";
import profileRoute from "./profileRoute.js";
import gameSessionRoute from "./gameSessionRoute.js";

const router = express.Router();

router.get("/", (_request, response) => {
  response.json({ message: "Welcome to the API!" });
});

router.use("/auth", authRoute);
router.use("/profile", profileRoute);
router.use("/game-sessions", gameSessionRoute);
export default router;
