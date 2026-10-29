import express from "express";
import authRoute from "./authRoute";
import profileRoute from "./profileRoute.js";
import gameSessionRoute from "./gameSessionRoute.js";
import gameHistoryRoute from "./gameHistoryRoute.js";
import progressRoute from "./progressRoute.js";
import gameCatalogRoute from "./gameCatalogRoute.js";
import imageRoute from "./imageRoute.js";

const router = express.Router();

router.get("/", (_request, response) => {
  response.json({ message: "Welcome to the API!" });
});

router.use("/auth", authRoute);
router.use("/profile", profileRoute);
router.use("/game-sessions", gameSessionRoute);
router.use("/game-sessions", gameHistoryRoute);
router.use("/progress", progressRoute);
router.use("/games", gameCatalogRoute);
router.use("/images", imageRoute);
export default router;
