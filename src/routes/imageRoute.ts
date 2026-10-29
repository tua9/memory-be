import express from "express";
import { getRandomImages } from "../controller/imageCard.controller.js";

const router = express.Router();

// GET /api/images/random?count=10
router.get("/random", getRandomImages);

export default router;
