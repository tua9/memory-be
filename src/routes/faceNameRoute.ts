import express from "express";
import {
  faceNameController,
  createFaceNameController,
} from "../controller/faceName.controller.js";
import type { FaceNameService } from "../services/faceName.service.js";

export const createFaceNameRouter = (service?: FaceNameService) => {
  const router = express.Router();
  const controller = service ? createFaceNameController(service) : faceNameController;

  router.get("/levels", controller.getLevels);
  router.post("/rounds", controller.createRound);
  router.post("/rounds/:roundId/submit", controller.submitRound);
  // Also support submit if roundId is in body or path
  router.post("/rounds/submit", controller.submitRound);

  return router;
};

export default createFaceNameRouter();

