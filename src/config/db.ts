import mongoose from "mongoose";
import { env } from "./env";

/**
 * Loại bỏ thông tin nhạy cảm (username, password) khỏi chuỗi kết nối MongoDB
 */
export const sanitizeMongoUri = (uri: string): string => {
    if (!uri) return "";
    return uri.replace(
        /(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/gi,
        "$1****$3",
    );
};

/**
 * Làm sạch thông báo lỗi, đảm bảo không vô tình lộ connection string hoặc credentials
 */
export const sanitizeErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return sanitizeMongoUri(error.message);
    }
    return typeof error === "string" ? sanitizeMongoUri(error) : "Unknown error";
};

/**
 * Chẩn đoán nguyên nhân lỗi kết nối MongoDB Atlas để thông báo rõ ràng cho lập trình viên
 */
export const diagnoseConnectionError = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: number })?.code;
    const name = (error as { name?: string })?.name;

    if (code === 8000 || /authentication failed|bad auth/i.test(message)) {
        return (
            "Authentication failed: Sai Database User username hoặc password. " +
            "Nếu mật khẩu chứa ký tự đặc biệt (@, #, :, /, ...), bạn cần percent-encode (RFC 3986)."
        );
    }

    if (name === "MongoServerSelectionError" || /ETIMEDOUT|timed out/i.test(message)) {
        return (
            "Server Selection Timeout: Không thể kết nối tới MongoDB Atlas cluster trong thời gian cho phép (10s). " +
            "Vui lòng kiểm tra kết nối mạng và đảm bảo IP hiện tại của bạn đã được cấp quyền trong 'Network Access' của MongoDB Atlas."
        );
    }

    if (/ENOTFOUND|querySrv/i.test(message)) {
        return (
            "DNS Lookup Failed: Không thể phân giải tên miền cluster Atlas. " +
            "Vui lòng kiểm tra lại hostname trong MONGODB_CONNECTION_STRING và kết nối DNS của hệ thống."
        );
    }

    if (/certificate|tls|ssl/i.test(message)) {
        return (
            "TLS/SSL Error: Lỗi xác thực chứng chỉ bảo mật khi kết nối tới MongoDB Atlas. " +
            "Vui lòng kiểm tra chứng chỉ hệ thống của môi trường chạy."
        );
    }

    return sanitizeErrorMessage(error);
};

export const connectDB = async (customConnectionString?: string): Promise<void> => {
    const connectionString = (customConnectionString ?? env.MONGODB_CONNECTION_STRING).trim();

    if (!connectionString) {
        throw new Error(
            "Missing mandatory configuration: MONGODB_CONNECTION_STRING is required and cannot be empty. " +
            "Vui lòng cấu hình chuỗi kết nối MongoDB Atlas trong file .env",
        );
    }

    try {
        await mongoose.connect(connectionString, {
            serverSelectionTimeoutMS: 10000, // Timeout 10s khi tìm server
            connectTimeoutMS: 10000,         // Timeout 10s khi mở kết nối TCP ban đầu
            maxPoolSize: 50,                 // Tái sử dụng connection pool
        });

        console.info(
            `Connected to MongoDB successfully [Database: "${mongoose.connection.name}"].`,
        );
    } catch (error) {
        const diagnosis = diagnoseConnectionError(error);
        console.error("Error connecting to MongoDB:", diagnosis);
        throw new Error(diagnosis);
    }
};