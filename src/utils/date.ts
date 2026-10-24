const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
    if (!DATE_KEY_PATTERN.test(dateKey)) {
        throw new RangeError(`Invalid date key "${dateKey}"`);
    }
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
