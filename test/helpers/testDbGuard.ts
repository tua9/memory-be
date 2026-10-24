import mongoose from "mongoose";

/**
 * Trích xuất tên database từ MongoDB connection string (hỗ trợ cả mongodb:// và mongodb+srv://)
 */
export const extractDatabaseName = (uri: string): string => {
    if (!uri || !uri.trim()) return "";
    try {
        const normalized = uri
            .trim()
            .replace(/^mongodb\+srv:\/\//i, "https://")
            .replace(/^mongodb:\/\//i, "http://");
        const parsed = new URL(normalized);
        const dbName = parsed.pathname.replace(/^\/+/, "").split("?")[0].trim();
        return dbName;
    } catch {
        // Fallback regex nếu URL parser không parse được một số URI đặc biệt
        const match = uri.match(/\/([^/?@]+)(?:\?|$)/);
        return match ? match[1].trim() : "";
    }
};

/**
 * Guard an toàn: Kiểm tra nghiêm ngặt cấu hình database test trước khi cho phép chạy integration test
 */
export const assertSafeTestDatabase = (
    testUri: string | undefined,
    appUri: string | undefined,
): string => {
    if (!testUri || !testUri.trim()) {
        throw new Error(
            "CONFIG ERROR: MONGODB_TEST_CONNECTION_STRING is not configured.\n" +
            "Integration tests require a dedicated test database to protect application data.\n" +
            "Please configure MONGODB_TEST_CONNECTION_STRING (e.g. mongodb://localhost:27017/memio_test or mongodb+srv://.../memio_test).",
        );
    }

    const testDbName = extractDatabaseName(testUri);
    if (!testDbName) {
        throw new Error(
            "SAFETY GUARD ERROR: Could not determine database name from MONGODB_TEST_CONNECTION_STRING.\n" +
            "Please specify a database name in the connection URI (e.g. .../memio_test?retryWrites=true).",
        );
    }

    // Nếu appUri có chỉ định db name, kiểm tra không được trùng nhau
    if (appUri && appUri.trim()) {
        const appDbName = extractDatabaseName(appUri);
        // Lưu ý: Nếu appUri không chỉ định db (ví dụ cluster.mongodb.net/), Mongoose mặc định dùng database "test"
        const effectiveAppDb = appDbName || "test";

        if (testDbName.toLowerCase() === effectiveAppDb.toLowerCase()) {
            throw new Error(
                `SAFETY GUARD ERROR: MONGODB_TEST_CONNECTION_STRING database name ("${testDbName}") ` +
                `matches the application database ("${effectiveAppDb}"). ` +
                "Integration tests are strictly forbidden from running against the application database!",
            );
        }
    }

    // Tên database test bắt buộc phải chứa "test"
    if (!/test/i.test(testDbName)) {
        throw new Error(
            `SAFETY GUARD ERROR: Database name "${testDbName}" does not contain "test". ` +
            "Test database name must clearly indicate a test environment (e.g. 'memio_test', 'test_db') " +
            "to prevent accidental writes to production or development databases.",
        );
    }

    return testDbName;
};

/**
 * Kết nối an toàn tới test database
 */
export const connectTestDB = async (): Promise<void> => {
    const testUri = process.env.MONGODB_TEST_CONNECTION_STRING;
    const appUri = process.env.MONGODB_CONNECTION_STRING;

    assertSafeTestDatabase(testUri, appUri);

    try {
        await mongoose.connect(testUri!, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
        });

        console.info(
            `Connected to isolated test database successfully [Database: "${mongoose.connection.name}"].`,
        );
    } catch (error) {
        console.error(
            "Failed to connect to test database:",
            error instanceof Error ? error.message : error,
        );
        throw error;
    }
};
