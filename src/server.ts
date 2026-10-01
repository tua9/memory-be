import "dotenv/config";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";

const startServer = async () => {
    await connectDB();
    app.listen(env.PORT, () => {
        console.info(`Server is running on port ${env.PORT} [${env.NODE_ENV}]`);
    });
};

startServer().catch((error: unknown) => {
    console.error("Failed to start server:", error);
    process.exitCode = 1;
});
