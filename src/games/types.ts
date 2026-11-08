import type { ConfiguredGameName } from "../config/games.js";
import type { RandomInt } from "../utils/random.js";

// Dữ liệu một item gửi cho frontend để hiển thị; trong DB chỉ lưu code
export interface ItemView {
    code: string;
    imageUrl?: string;
    label?: string;
}

// Phần riêng của từng game: sinh đề, lựa chọn khi nhớ lại và cách hiển thị item
export interface GameEngine {
    gameName: ConfiguredGameName;
    // Generate the challenge items; the engine decides whether repeated items are meaningful (e.g. digits).
    // random: nguồn ngẫu nhiên có seed khi cần đề lặp lại được (thử thách ngày)
    generateItems(count: number, level: number | null, random?: RandomInt): string[];
    // Các lựa chọn ở phase nhớ lại; câu trả lời hợp lệ phải nằm trong danh sách này
    buildRecallOptions(items: readonly string[]): string[];
    toView(code: string): ItemView;
    toRecallView?(code: string): ItemView;
    parseAnswers?(items: readonly string[], answers: unknown): (string | null)[];
    matches?(expected: string, answer: string | null): boolean;
    answerView?(answer: string): ItemView;
}
