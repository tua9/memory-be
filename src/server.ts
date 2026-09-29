import "dotenv/config";
import app from "./app";
import { env } from "./config/env";

app.listen(env.port, () => {
    console.info(`API listening on port ${env.port} (${env.nodeEnv})`);
});
