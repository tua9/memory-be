import "dotenv/config";
import app from "./app";
import { connectDB } from "./config/db";
import { env } from "./config/env";

const startServer = async () => {
    await connectDB();
    app.listen(env.PORT, () => {
        console.info(`Server is running on port ${env.PORT} [${env.BUILD_MODE}]`);
    });
};

startServer().catch((error: unknown) => {
    console.error("Failed to start server:", error);
    process.exitCode = 1;
});
