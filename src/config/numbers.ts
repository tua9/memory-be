// Trò Ghi nhớ số: số chữ số của từng cấp, phần tử đầu tiên là cấp 1.
// Đúng hết ở một cấp thì mở cấp tiếp theo; frontend đọc bảng này qua GET /numbers/progress.
export const NUMBER_LEVEL_DIGITS = [8, 12, 18, 24, 30, 40, 50, 60, 70, 80] as const;
export const NUMBER_MAX_LEVEL = NUMBER_LEVEL_DIGITS.length;
