export interface FaceNameLevelConfig {
  levelId: number;
  faceCount: number;
  memorizeSeconds: number;
  recallSeconds: number;
  nameType: string;
  requiredScore: number;
  unlockThreshold: number;
}

export const FACENAME_LEVELS: readonly FaceNameLevelConfig[] = [
  {
    levelId: 1,
    faceCount: 6,
    memorizeSeconds: 60,
    recallSeconds: 120,
    nameType: "Tên phổ biến",
    requiredScore: 4,
    unlockThreshold: 4 / 6,
  },
  {
    levelId: 2,
    faceCount: 8,
    memorizeSeconds: 60,
    recallSeconds: 150,
    nameType: "Tên phổ biến",
    requiredScore: 6,
    unlockThreshold: 6 / 8,
  },
  {
    levelId: 3,
    faceCount: 10,
    memorizeSeconds: 60,
    recallSeconds: 180,
    nameType: "Tên đa dạng (Việt + Quốc tế)",
    requiredScore: 7,
    unlockThreshold: 7 / 10,
  },
  {
    levelId: 4,
    faceCount: 12,
    memorizeSeconds: 60,
    recallSeconds: 180,
    nameType: "Tên đa dạng (Việt + Quốc tế)",
    requiredScore: 8,
    unlockThreshold: 8 / 12,
  },
  {
    levelId: 5,
    faceCount: 14,
    memorizeSeconds: 60,
    recallSeconds: 210,
    nameType: "Tên quốc tế",
    requiredScore: 10,
    unlockThreshold: 10 / 14,
  },
  {
    levelId: 6,
    faceCount: 16,
    memorizeSeconds: 60,
    recallSeconds: 210,
    nameType: "Tên quốc tế phong phú",
    requiredScore: 11,
    unlockThreshold: 11 / 16,
  },
  {
    levelId: 7,
    faceCount: 18,
    memorizeSeconds: 60,
    recallSeconds: 240,
    nameType: "Tên quốc tế phong phú",
    requiredScore: 12,
    unlockThreshold: 12 / 18,
  },
  {
    levelId: 8,
    faceCount: 22,
    memorizeSeconds: 60,
    recallSeconds: 240,
    nameType: "Tên quốc tế thử thách",
    requiredScore: 15,
    unlockThreshold: 15 / 22,
  },
  {
    levelId: 9,
    faceCount: 26,
    memorizeSeconds: 60,
    recallSeconds: 270,
    nameType: "Tên quốc tế dễ nhầm lẫn",
    requiredScore: 18,
    unlockThreshold: 18 / 26,
  },
  {
    levelId: 10,
    faceCount: 30,
    memorizeSeconds: 60,
    recallSeconds: 300,
    nameType: "Tên quốc tế dễ nhầm lẫn",
    requiredScore: 20,
    unlockThreshold: 20 / 30,
  },
] as const;

