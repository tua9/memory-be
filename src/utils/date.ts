const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseDateKey = (dateKey: string): [year: number, month: number, day: number] => {
    if (!DATE_KEY_PATTERN.test(dateKey)) {
        throw new RangeError(`Invalid date key "${dateKey}"`);
    }
    const [year, month, day] = dateKey.split("-").map(Number);
    return [year, month, day];
};

// Ngày "YYYY-MM-DD" của một thời điểm theo múi giờ cho trước.
// Không dùng toISOString vì nó luôn theo UTC: 06:00 sáng giờ Việt Nam vẫn là ngày hôm trước.
export const toDateKey = (date: Date, timeZone: string): string => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? "";

    return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
};

// Cộng hoặc trừ số ngày trên một ngày dạng "YYYY-MM-DD"
export const addDaysToDateKey = (dateKey: string, days: number): string => {
    const [year, month, day] = parseDateKey(dateKey);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

// Ngày đầu tháng "YYYY-MM-01" sau khi cộng hoặc trừ số tháng
export const addMonthsToDateKey = (dateKey: string, months: number): string => {
    const [year, month] = parseDateKey(dateKey);
    return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
};

// Thứ trong tuần của một ngày "YYYY-MM-DD": 0 là Chủ nhật, 1 là Thứ hai, ..., 6 là Thứ bảy
export const weekdayOfDateKey = (dateKey: string): number => {
    const [year, month, day] = parseDateKey(dateKey);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

// Độ lệch (ms) giữa giờ địa phương của múi giờ và giờ UTC tại một thời điểm
const timeZoneOffsetMs = (date: Date, timeZone: string): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(date);
    const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value);
    const wallClockAsUtc = Date.UTC(
        valueOf("year"),
        valueOf("month") - 1,
        valueOf("day"),
        valueOf("hour"),
        valueOf("minute"),
        valueOf("second"),
    );
    return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
};

// Thời điểm 00:00 của một ngày "YYYY-MM-DD" theo múi giờ cho trước, ví dụ
// 00:00 ngày 24/10 giờ Việt Nam là 17:00 ngày 23/10 theo UTC.
// Lấy độ lệch tại 00:00 UTC cùng ngày, đủ chính xác cho múi giờ không đổi giờ theo mùa như Việt Nam.
export const startOfDateKey = (dateKey: string, timeZone: string): Date => {
    const [year, month, day] = parseDateKey(dateKey);
    const utcMidnight = Date.UTC(year, month - 1, day);
    return new Date(utcMidnight - timeZoneOffsetMs(new Date(utcMidnight), timeZone));
};
