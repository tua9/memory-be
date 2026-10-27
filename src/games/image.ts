import { shuffle } from "../utils/random.js";
import type { GameEngine } from "./types.js";

// Kho ảnh của game; mã ảnh là id ảnh trên Unsplash. Cần ít nhất bằng số ảnh của level cao nhất.
export const IMAGE_CODES: readonly string[] = [
    "photo-1543466835-00a7907e9de1", // Chú chó vui vẻ
    "photo-1514888286974-6c03e2ca1dba", // Mèo mướp vàng
    "photo-1552053831-71594a27632d", // Chó Golden
    "photo-1537151625747-768eb6cf92b2", // Cún con dễ thương
    "photo-1506744038136-46273834b3fb", // Hồ nước và núi non
    "photo-1470071459604-3b5ec3a7fe05", // Sương mù trên đồi
    "photo-1441974231531-c6227db76b6e", // Ánh nắng trong rừng
    "photo-1507525428034-b723cf961d3e", // Bãi biển nhiệt đới
    "photo-1464822759023-fed622ff2c3b", // Dãy núi phủ tuyết
    "photo-1501785888041-af3ef285b470", // Thuyền trên hồ xanh
    "photo-1518791841217-8f162f1e1131", // Mèo con mắt xanh
    "photo-1472214103451-9374bd1c798e", // Cây đơn độc trên đồng
    "photo-1546069901-ba9599a7e63c", // Bát salad lành mạnh
    "photo-1565299624946-b28f40a0ae38", // Bánh pizza hấp dẫn
    "photo-1567620905732-2d1ec7ab7445", // Bánh pancake chuối
    "photo-1540420773420-3366772f4999", // Salad rau xanh tươi mát
    "photo-1555396273-367ea4eb4db5", // Bữa tối ấm cúng
    "photo-1563729784474-d77dbb933a9e", // Bánh ngọt tráng miệng
    "photo-1512621776951-a57141f2eefd", // Tô bún rau củ
    "photo-1498837167922-ddd27525d352", // Trái cây mùa hè
    "photo-1513694203232-719a280e022f", // Phòng khách ấm áp
    "photo-1497366216548-37526070297c", // Bàn làm việc hiện đại
    "photo-1486406146926-c627a92ad1ab", // Tòa cao ốc kính
    "photo-1492691527719-9d1e07e534b4", // Nhiếp ảnh gia tác nghiệp
];

const IMAGE_CODE_SET = new Set(IMAGE_CODES);

// Link thẳng tới CDN (picsum chuyển hướng 302 nên ảnh hiện chậm). Ván cũ lưu mã ngẫu nhiên vẫn dùng picsum để hiển thị lại được.
const imageUrlOf = (code: string) =>
    IMAGE_CODE_SET.has(code)
        ? `https://images.unsplash.com/${code}?auto=format&fit=crop&w=400&h=400&q=80`
        : `https://picsum.photos/seed/memio-${code}/400/400`;

export const imageEngine: GameEngine = {
    gameName: "image",
    generateItems: (count) => {
        if (!Number.isInteger(count) || count < 1 || count > IMAGE_CODES.length) {
            throw new RangeError(`Image count must be an integer from 1 to ${IMAGE_CODES.length}`);
        }
        return shuffle(IMAGE_CODES).slice(0, count);
    },
    // Người chơi xếp lại chính các ảnh đã nhớ, theo thứ tự đã bị xáo trộn
    buildRecallOptions: (items) => shuffle(items),
    toView: (code) => ({ code, imageUrl: imageUrlOf(code) }),
};
