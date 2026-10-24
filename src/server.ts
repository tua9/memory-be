import "dotenv/config";
import mongoose from "mongoose";
import app from "./app";
import { connectDB } from "./config/db";
import { env } from "./config/env";
import {
    startNumberSweepWorker,
    stopNumberSweepWorker,
} from "./services/numberSweep.service.js";

const startServer = async () => {
    await connectDB();
    startNumberSweepWorker();
    const server = app.listen(env.PORT, () => {
        console.info(`Server is running on port ${env.PORT} [${env.NODE_ENV}]`);
    });

    const shutdown = async () => {
        stopNumberSweepWorker();
        try {
            await mongoose.disconnect();
            console.info("MongoDB connection closed.");
        } catch (err) {
            console.error("Error closing MongoDB connection:", err instanceof Error ? err.message : err);
        }
        server.close(() => {
            process.exit(0);
        });
    };

    process.on("SIGINT", () => { void shutdown(); });
    process.on("SIGTERM", () => { void shutdown(); });
};

startServer().catch((error: unknown) => {
    console.error("Failed to start server:", error instanceof Error ? error.message : "Startup error");
    process.exitCode = 1;
});
