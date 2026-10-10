import dotenv from "dotenv";

dotenv.config();

const NODE_ENVS = ["development", "production", "test"] as const;
type NodeEnv = (typeof NODE_ENVS)[number];

const NODE_ENV = process.env.NODE_ENV || "development";
if (!NODE_ENVS.includes(NODE_ENV as NodeEnv)) {
    throw new Error(`Invalid NODE_ENV "${NODE_ENV}". Expected one of: ${NODE_ENVS.join(", ")}`);
}

export const env = {
    NODE_ENV: NODE_ENV as NodeEnv,
    IS_PRODUCTION: NODE_ENV === "production",
    PORT: process.env.PORT || 5001,
    CLIENT_URL: process.env.CLIENT_URL || "http://localhost:5173",
    MONGODB_CONNECTION_STRING: process.env.MONGODB_CONNECTION_STRING || "",
    ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET || "",
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || "",
    ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || "15m",
    REFRESH_TOKEN_TTL: process.env.REFRESH_TOKEN_TTL || "14d",
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
};