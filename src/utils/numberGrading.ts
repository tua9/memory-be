import crypto from "node:crypto";

export type ComparisonStatus = "correct" | "wrong" | "blank";

export interface ComparisonItem {
    index: number;
    expected: string;
    actual: string | null;
    status: ComparisonStatus;
}

export interface GradingResult {
    correctCount: number;
    wrongCount: number;
    blankCount: number;
    total: number;
    score: number;
    accuracy: number;
    comparison: ComparisonItem[];
}

/**
 * Sinh dãy ngẫu nhiên các chữ số từ "0" đến "9" dùng node:crypto.
 * Cho phép số "0" đứng đầu và chữ số lặp lại.
 */
export const generateRandomDigits = (count: number): string[] => {
    if (count <= 0) {
        return [];
    }
    const digits: string[] = [];
    for (let i = 0; i < count; i++) {
        digits.push(crypto.randomInt(0, 10).toString());
    }
    return digits;
};

/**
 * Chấm điểm bài làm so với dãy gốc.
 * So sánh độc lập từng vị trí:
 * - Đúng: 1 điểm, status = "correct"
 * - Sai: 0 điểm, status = "wrong"
 * - Bỏ trống (null hoặc chuỗi rỗng): 0 điểm, status = "blank"
 * - Không dừng sau lỗi đầu tiên, không trừ điểm.
 * - accuracy = (correctCount / total) * 100, làm tròn tối đa 2 chữ số thập phân.
 */
export const gradeAnswers = (
    originalDigits: readonly string[],
    answers: readonly (string | null)[],
): GradingResult => {
    const total = originalDigits.length;
    let correctCount = 0;
    let wrongCount = 0;
    let blankCount = 0;

    const comparison: ComparisonItem[] = [];

    for (let i = 0; i < total; i++) {
        const expected = originalDigits[i];
        const actual = i < answers.length ? (answers[i] ?? null) : null;

        let status: ComparisonStatus;
        if (actual === null || actual === "") {
            status = "blank";
            blankCount++;
        } else if (actual === expected) {
            status = "correct";
            correctCount++;
        } else {
            status = "wrong";
            wrongCount++;
        }

        comparison.push({
            index: i,
            expected,
            actual,
            status,
        });
    }

    const score = correctCount; // 1 điểm cho mỗi vị trí đúng
    const rawAccuracy = total > 0 ? (correctCount / total) * 100 : 0;
    // Làm tròn tối đa 2 chữ số thập phân, ví dụ 75 hoặc 33.33
    const accuracy = Math.round(rawAccuracy * 100) / 100;

    return {
        correctCount,
        wrongCount,
        blankCount,
        total,
        score,
        accuracy,
        comparison,
    };
};
