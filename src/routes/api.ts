import express from "express";
import authRoute from "./authRoute";
import profileRoute from "./profileRoute.js";
import gameSessionRoute from "./gameSessionRoute.js";
import gameHistoryRoute from "./gameHistoryRoute.js";
import progressRoute from "./progressRoute.js";
import gameCatalogRoute from "./gameCatalogRoute.js";
import dailyChallengeRoute from "./dailyChallengeRoute.js";
import numberSessionRoute from "./numberSessionRoute.js";
import faceNameRoute from "./faceNameRoute.js";
import wordsSessionRoute from "./wordsSessionRoute.js";

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
router.use("/daily-challenge", dailyChallengeRoute);

router.use("/game", faceNameRoute);
router.use("/facename", faceNameRoute);

router.use("/v1/numbers", numberSessionRoute);
router.use("/numbers", numberSessionRoute);

router.use("/v1/words", wordsSessionRoute);
router.use("/words", wordsSessionRoute);

export default router;
