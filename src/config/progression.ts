// Các con số quyết định EXP, cấp tài khoản và cách tính "một ngày"; muốn cân chỉnh thì sửa ở đây

export const EXP_RULES = {
    // Trần EXP theo tỷ lệ đúng của một ván = số thẻ/hình × expPerItem
    expPerItem: 3,
    perfectBonus: 10,
    // Ván chưa đạt chỉ nhận phần này của EXP theo tỷ lệ đúng
    failMultiplier: 0.5,
    // EXP tối thiểu cho một ván đã nộp bài, kể cả khi không nhớ đúng thẻ nào
    minRoundExp: 1,
    firstGameOfDayBonus: 10,
    // Cộng một lần cho mỗi ván, dù ván đó phá nhiều kỷ lục
    newRecordBonus: 20,
} as const;

// Lên từ cấp n lên cấp n + 1 cần USER_LEVEL_EXP_STEP × n EXP
export const USER_LEVEL_EXP_STEP = 100;

// Múi giờ xác định ranh giới ngày khi tính streak và ván đầu tiên trong ngày
export const PROGRESS_TIME_ZONE = "Asia/Ho_Chi_Minh";
