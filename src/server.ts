import "dotenv/config";
import app from "./app";
import { connectDB } from "./config/db";
import { env } from "./config/env";
import { imageCardService } from "./services/imageCard.service.js";

const startServer = async () => {
    await connectDB();
    await imageCardService.ensureSeedData();
    app.listen(env.PORT, () => {
        console.info(`Server is running on port ${env.PORT} [${env.NODE_ENV}]`);
    });
};

startServer().catch((error: unknown) => {
    console.error("Failed to start server:", error);
    process.exitCode = 1;
});
