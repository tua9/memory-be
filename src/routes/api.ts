import express from "express";
import authRoute from "./authRoute.js";

const router = express.Router();

router.get("/", (_request, response) => {
    response.json({ message: "Welcome to the API!" });
});

router.use("/auth", authRoute);

export default router;