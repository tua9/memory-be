import type { ConfiguredGameName } from "../config/games.js";
import type { RandomInt } from "../utils/random.js";

// Dữ liệu một item gửi cho frontend để hiển thị; trong DB chỉ lưu code
export interface ItemView {
    code: string;
    imageUrl?: string;
}

// Phần riêng của từng game: sinh đề, lựa chọn khi nhớ lại và cách hiển thị item
export interface GameEngine {
    gameName: ConfiguredGameName;
    // Sinh bộ item cần nhớ, không có item trùng nhau; level null với ván tự chọn số lượng.
    // random: nguồn ngẫu nhiên có seed khi cần đề lặp lại được (thử thách ngày)
    generateItems(count: number, level: number | null, random?: RandomInt): string[];
    // Các lựa chọn ở phase nhớ lại; câu trả lời hợp lệ phải nằm trong danh sách này
    buildRecallOptions(items: readonly string[]): string[];
    toView(code: string): ItemView;
}
