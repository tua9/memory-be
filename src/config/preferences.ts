// Mục tiêu luyện tập người dùng tự chọn, để gợi ý trò chơi, mục tiêu mỗi ngày và độ khó cho hợp.
// Frontend giữ nhãn hiển thị của từng giá trị; thêm giá trị mới thì sửa cả hai nơi.

export const TRAINING_GOALS = ["language", "names", "exam", "numbers", "brain"] as const;
export type TrainingGoal = (typeof TRAINING_GOALS)[number];

// Số phút muốn luyện mỗi ngày
export const DAILY_MINUTES_OPTIONS = [5, 15, 30] as const;
export type DailyMinutes = (typeof DAILY_MINUTES_OPTIONS)[number];

// Ngày thi chỉ có nghĩa khi chọn mục tiêu "exam", và không được xa hơn số năm này
export const TARGET_DATE_MAX_YEARS = 3;
