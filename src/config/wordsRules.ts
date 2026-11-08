export interface WordLevelConfig {
  level: number;
  itemCount: number;
  requiredScore: number;
  memorizeSeconds: number;
  recallSeconds: number;
  unlockThreshold: number;
}

export const WORDS_LEVELS: readonly WordLevelConfig[] = [
  {
    level: 1,
    itemCount: 6,
    requiredScore: 4,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 4 / 6,
  },
  {
    level: 2,
    itemCount: 10,
    requiredScore: 7,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 7 / 10,
  },
  {
    level: 3,
    itemCount: 14,
    requiredScore: 10,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 10 / 14,
  },
  {
    level: 4,
    itemCount: 18,
    requiredScore: 12,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 12 / 18,
  },
  {
    level: 5,
    itemCount: 22,
    requiredScore: 15,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 15 / 22,
  },
  {
    level: 6,
    itemCount: 26,
    requiredScore: 18,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 18 / 26,
  },
  {
    level: 7,
    itemCount: 30,
    requiredScore: 20,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 20 / 30,
  },
  {
    level: 8,
    itemCount: 35,
    requiredScore: 24,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 24 / 35,
  },
  {
    level: 9,
    itemCount: 42,
    requiredScore: 28,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 28 / 42,
  },
  {
    level: 10,
    itemCount: 50,
    requiredScore: 34,
    memorizeSeconds: 60,
    recallSeconds: 240,
    unlockThreshold: 34 / 50,
  },
];

export const SUPPORTED_LANGUAGES = [
  { code: "vi", label: "Tiếng Việt", nativeName: "Tiếng Việt" },
  { code: "en", label: "English", nativeName: "English" },
  { code: "fr", label: "French", nativeName: "Français" },
  { code: "ja", label: "Japanese", nativeName: "日本語" },
  { code: "ko", label: "Korean", nativeName: "한국어" },
  { code: "zh", label: "Chinese", nativeName: "中文" },
  { code: "ru", label: "Russian", nativeName: "Русский" },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const WORDS_MEMORIZE_OPTIONS = [30, 60, 120, 300] as const;
export const DEFAULT_MEMORIZE_SECONDS = 60;
export const DEFAULT_RECALL_SECONDS = 240;

