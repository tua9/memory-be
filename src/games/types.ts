import type { ConfiguredGameName } from "../config/games.js";

// Dữ liệu một item gửi cho frontend để hiển thị; trong DB chỉ lưu code
export interface ItemView {
    code: string;
    imageUrl?: string;
}

// Phần riêng của từng game: sinh đề, lựa chọn khi nhớ lại và cách hiển thị item
export interface GameEngine {
    gameName: ConfiguredGameName;
    // Sinh bộ item cần nhớ, không có item trùng nhau
    generateItems(count: number): string[];
    // Các lựa chọn ở phase nhớ lại; câu trả lời hợp lệ phải nằm trong danh sách này
    buildRecallOptions(items: readonly string[]): string[];
    toView(code: string): ItemView;
}
