import express from "express";
import authRoute from "./authRoute";
import profileRoute from "./profileRoute.js";
import gameSessionRoute from "./gameSessionRoute.js";
import numberSessionRoute from "./numberSessionRoute.js";

const router = express.Router();

router.get("/", (_request, response) => {
  response.json({ message: "Welcome to the API!" });
});

router.use("/auth", authRoute);
router.use("/profile", profileRoute);
router.use("/game-sessions", gameSessionRoute);
router.use("/v1/numbers", numberSessionRoute);
router.use("/numbers", numberSessionRoute);
export default router;
