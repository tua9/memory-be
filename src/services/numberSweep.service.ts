import {
    numberSessionRepository,
    type NumberSessionRepository,
} from "../repositories/numberSession.repository.js";
import {
    numberSessionService,
    type NumberSessionService,
} from "./numberSession.service.js";

let sweepTimer: NodeJS.Timeout | null = null;
let isSweeping = false;

/**
 * Xử lý một đợt các lượt chơi đã hết hạn nhưng chưa được hoàn thành.
 * Quét theo batch nhỏ và an toàn với lỗi.
 */
export const sweepExpiredSessions = async (
    service: NumberSessionService = numberSessionService,
    repository: NumberSessionRepository = numberSessionRepository,
    now: Date = new Date(),
    batchSize = 20,
): Promise<number> => {
    if (isSweeping) {
        return 0;
    }
    isSweeping = true;

    try {
        const candidates = await repository.findExpiredCandidates(now, batchSize);
        let processedCount = 0;

        for (const candidate of candidates) {
            try {
                await service.syncDeadlines(candidate, now);
                processedCount++;
            } catch (itemError) {
                console.error(
                    `Failed to sweep expired session ${candidate._id.toString()}:`,
                    itemError,
                );
            }
        }

        return processedCount;
    } catch (error) {
        console.error("Error during sweepExpiredSessions:", error);
        return 0;
    } finally {
        isSweeping = false;
    }
};

/**
 * Khởi động background worker quét lượt chơi hết hạn định kỳ.
 */
export const startNumberSweepWorker = (
    intervalMs = 5000,
    service: NumberSessionService = numberSessionService,
    repository: NumberSessionRepository = numberSessionRepository,
): NodeJS.Timeout => {
    stopNumberSweepWorker();

    sweepTimer = setInterval(() => {
        void sweepExpiredSessions(service, repository);
    }, intervalMs);

    // Không ngăn Node.js tiến trình thoát tự nhiên nếu chỉ còn timer này
    if (typeof sweepTimer.unref === "function") {
        sweepTimer.unref();
    }

    return sweepTimer;
};

/**
 * Dừng worker phục vụ graceful shutdown và unit/integration testing.
 */
export const stopNumberSweepWorker = (): void => {
    if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
    }
};
