import mongoose from "mongoose";
import { env } from "./env.js";

export const connectDB = async (): Promise<void> => {
    try {
        await mongoose.connect(env.MONGODB_CONNECTION_STRING);
        console.info("Connected to MongoDB successfully.");
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        throw error;
    }
};