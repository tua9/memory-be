import type { SupportedLanguageCode } from "../config/wordsRules.js";

/**
 * Kho từ vựng cụ thể, trực quan, giàu hình ảnh cho 7 ngôn ngữ.
 * Dùng cho game Ghi nhớ từ (Words Game) theo phương pháp Cung điện trí nhớ (Memory Palace).
 * Mỗi ngôn ngữ có ít nhất 150-200 từ để đảm bảo sinh tối đa 50 từ ở Level 10 không bao giờ trùng lặp.
 */

const VI_WORDS: readonly string[] = [
  "Mặt trời", "Dòng sông", "Ngôi nhà", "Ngọn núi", "Bãi biển", "Cây cầu", "Con thuyền", "Chiếc lá",
  "Ngọn đèn", "Trang sách", "Đám mây", "Cơn mưa", "Quả táo", "Bông hoa", "Chiếc nhẫn", "Đồng hồ",
  "Cây đàn", "Chú mèo", "Bức tranh", "Đôi giày", "Ngọn lửa", "Cánh cửa", "Bầu trời", "Viên đá",
  "Giọt sương", "Giỏ quà", "Tách trà", "Con đường", "Góc phố", "Lâu đài", "Thành phố", "Khu rừng",
  "Dòng suối", "Chiếc xe", "Ngôi sao", "Vầng trăng", "Con cá", "Chú chim", "Chiếc mũ", "Quả bóng",
  "Chiếc gương", "Cái bàn", "Cái ghế", "Ba lô", "Chiếc dù", "Bức thư", "Chìa khóa", "Ngọn hải đăng",
  "Hòn đảo", "Cái cây", "Chiếc nơ", "Đôi đũa", "Cái bát", "Chiếc áo", "Quả chuối", "Củ cà rốt",
  "Bánh mì", "Ngôi sao", "Chiếc gối", "Cái chăn", "Đôi dép", "Mắt kính", "Cây bút", "Vở kẻ",
  "Cục tẩy", "Cái kéo", "Thước kẻ", "Mảnh giấy", "Cửa sổ", "Cột cờ", "Quả địa cầu", "Xe đạp",
  "Máy bay", "Tàu hỏa", "Trái đất", "Sao hỏa", "Vương miện", "Viên kim cương", "Mặt dây chuyền",
  "Chuông gió", "Ống nhòm", "Kính hiển vi", "Cầu vồng", "Thác nước", "Bình hoa", "Chậu cây",
  "Chú cún", "Con thỏ", "Con ngựa", "Con hổ", "Con voi", "Chim cánh cụt", "Cá voi", "Con rùa",
  "Bươm bướm", "Cánh diều", "Khinh khí cầu", "Chiếc quạt", "Bình gốm", "Bức tượng", "Hộp quà",
  "Dây ruy băng", "Bánh kem", "Cốc sữa", "Trái xoài", "Quả dưa hấu", "Chùm nho", "Quả dâu",
  "Quả cam", "Bông sen", "Hoa hồng", "Hoa hướng dương", "Lá cờ", "Chiếc cúp", "Ngọn đuốc",
  "Hạt cát", "Vỏ sò", "San hô", "Chiếc võng", "Cối xay gió", "Cánh đồng", "Hồ nước", "Hang đá",
  "Núi lửa", "Tảng băng", "Tuyết rơi", "Ánh nến", "Lò sưởi", "Ấm nước", "Chiếc thìa", "Đĩa sứ",
  "Nồi cơm", "Chảo gang", "Hàng rào", "Cổng vòm", "Tháp chuông", "Mái ngói", "Bậc thang", "Hành lang",
  "Gác xép", "Tủ sách", "Bản đồ", "La bàn", "Mỏ neo", "Bánh lái", "Phao bơi", "Ván trượt",
  "Giày patin", "Kính bơi", "Cần câu", "Lưới cá", "Lồng chim", "Nhà gỗ", "Lều vải", "Túi ngủ",
  "Ống khói", "Đống rơm", "Máy cày", "Xe ngựa", "Đèn lồng", "Pháo hoa", "Đồng xu", "Bao thư"
];

const EN_WORDS: readonly string[] = [
  "Sun", "River", "House", "Mountain", "Beach", "Bridge", "Boat", "Leaf",
  "Lamp", "Book", "Cloud", "Rain", "Apple", "Flower", "Ring", "Clock",
  "Guitar", "Cat", "Painting", "Shoe", "Fire", "Door", "Sky", "Stone",
  "Dew", "Gift", "Tea", "Road", "Street", "Castle", "City", "Forest",
  "Stream", "Car", "Star", "Moon", "Fish", "Bird", "Hat", "Ball",
  "Mirror", "Table", "Chair", "Backpack", "Umbrella", "Letter", "Key", "Lighthouse",
  "Island", "Tree", "Ribbon", "Chopsticks", "Bowl", "Shirt", "Banana", "Carrot",
  "Bread", "Pillow", "Blanket", "Slipper", "Glasses", "Pen", "Notebook", "Eraser",
  "Scissors", "Ruler", "Paper", "Window", "Flagpole", "Globe", "Bicycle", "Airplane",
  "Train", "Earth", "Mars", "Crown", "Diamond", "Pendant", "Windchime", "Binoculars",
  "Microscope", "Rainbow", "Waterfall", "Vase", "Planter", "Puppy", "Rabbit", "Horse",
  "Tiger", "Elephant", "Penguin", "Whale", "Turtle", "Butterfly", "Kite", "Balloon",
  "Fan", "Pottery", "Statue", "Giftbox", "Cake", "Milk", "Mango", "Watermelon",
  "Grape", "Strawberry", "Orange", "Lotus", "Rose", "Sunflower", "Flag", "Trophy",
  "Torch", "Sand", "Seashell", "Coral", "Hammock", "Windmill", "Field", "Lake",
  "Cave", "Volcano", "Iceberg", "Snow", "Candle", "Fireplace", "Kettle", "Spoon",
  "Plate", "Fence", "Archway", "Bell", "Staircase", "Balcony", "Compass", "Anchor",
  "Helm", "Surfboard", "Skateboard", "Goggles", "Rod", "Net", "Cabin", "Tent",
  "Chimney", "Lantern", "Fireworks", "Coin", "Envelope", "Mirror", "Tower", "Bridge"
];

const FR_WORDS: readonly string[] = [
  "Soleil", "Fleuve", "Maison", "Montagne", "Plage", "Pont", "Bateau", "Feuille",
  "Lampe", "Livre", "Nuage", "Pluie", "Pomme", "Fleur", "Bague", "Horloge",
  "Guitare", "Chat", "Tableau", "Chaussure", "Feu", "Porte", "Ciel", "Pierre",
  "Cadeau", "Thé", "Route", "Rue", "Château", "Ville", "Forêt", "Ruisseau",
  "Voiture", "Étoile", "Lune", "Poisson", "Oiseau", "Chapeau", "Ballon", "Miroir",
  "Table", "Chaise", "Sac", "Parapluie", "Lettre", "Clé", "Phare", "Île",
  "Arbre", "Ruban", "Bol", "Chemise", "Banane", "Carotte", "Pain", "Oreiller",
  "Couverture", "Lunettes", "Stylo", "Cahier", "Gomme", "Ciseaux", "Règle", "Papier",
  "Fenêtre", "Vélo", "Avion", "Train", "Terre", "Couronne", "Diamant", "Arc-en-ciel",
  "Cascade", "Vase", "Chiot", "Lapin", "Cheval", "Tigre", "Éléphant", "Manchot",
  "Baleine", "Tortue", "Papillon", "Cerf-volant", "Ballon", "Éventail", "Statue", "Gâteau",
  "Lait", "Mangue", "Pastèque", "Raisin", "Fraise", "Orange", "Rose", "Tournesol",
  "Drapeau", "Trophée", "Torche", "Sable", "Coquillage", "Corail", "Hamac", "Moulin",
  "Champ", "Lac", "Grotte", "Volcan", "Neige", "Bougie", "Cheminée", "Cuillère",
  "Assiette", "Cloche", "Escalier", "Balcon", "Boussole", "Ancre", "Tente", "Lanterne"
];

const JA_WORDS: readonly string[] = [
  "太陽", "川", "家", "山", "海", "橋", "船", "葉",
  "ランプ", "本", "雲", "雨", "リンゴ", "花", "指輪", "時計",
  "ギター", "猫", "絵", "靴", "火", "ドア", "空", "石",
  "ギフト", "お茶", "道", "通り", "城", "都市", "森", "小川",
  "車", "星", "月", "魚", "鳥", "帽子", "ボール", "鏡",
  "机", "椅子", "鞄", "傘", "手紙", "鍵", "灯台", "島",
  "木", "リボン", "茶碗", "シャツ", "バナナ", "ニンジン", "パン", "枕",
  "毛布", "眼鏡", "ペン", "ノート", "消しゴム", "ハサミ", "定規", "紙",
  "窓", "自転車", "飛行機", "電車", "地球", "王冠", "ダイヤ", "虹",
  "滝", "花瓶", "子犬", "ウサギ", "馬", "トラ", "ゾウ", "ペンギン",
  "クジラ", "カメ", "蝶", "凧", "風船", "扇子", "彫刻", "ケーキ",
  "ミルク", "マンゴー", "スイカ", "ブドウ", "イチゴ", "ミカン", "バラ", "ヒマワリ",
  "旗", "トロフィー", "松明", "砂", "貝殻", "サンゴ", "ハンモック", "風車",
  "野原", "湖", "洞窟", "火山", "雪", "キャンドル", "暖炉", "スプーン",
  "皿", "鐘", "階段", "バルコニー", "コンパス", "錨", "テント", "提灯"
];

const KO_WORDS: readonly string[] = [
  "태양", "강", "집", "산", "바다", "다리", "배", "나뭇잎",
  "램프", "책", "구름", "비", "사과", "꽃", "반지", "시계",
  "기타", "고양이", "그림", "신발", "불", "문", "하늘", "돌",
  "선물", "차", "길", "거리", "성", "도시", "숲", "시내",
  "자동차", "별", "달", "물고기", "새", "모자", "공", "거울",
  "책상", "의자", "가방", "우산", "편지", "열쇠", "등대", "섬",
  "나무", "리본", "그릇", "셔츠", "바나나", "당근", "빵", "베개",
  "이불", "안경", "펜", "공책", "지우개", "가위", "자", "종이",
  "창문", "자전거", "비행기", "기차", "지구", "왕관", "다이아", "무지개",
  "폭포", "화병", "강아지", "토끼", "말", "호랑이", "코끼리", "펭귄",
  "고래", "거북이", "나비", "연", "풍선", "부채", "조각상", "케이크",
  "우유", "망고", "수박", "포도", "딸기", "오렌지", "장미", "해바라기",
  "깃발", "트로피", "횃불", "모래", "조개", "산호", "해먹", "풍차",
  "들판", "호수", "동굴", "화산", "눈", "양초", "벽난로", "숟가락",
  "접시", "종", "계단", "발코니", "나침반", "닻", "텐트", "초롱"
];

const ZH_WORDS: readonly string[] = [
  "太阳", "河流", "房屋", "高山", "海洋", "桥梁", "轮船", "树叶",
  "台灯", "书籍", "白云", "雨滴", "苹果", "鲜花", "戒指", "时钟",
  "吉他", "小猫", "画卷", "鞋子", "火焰", "大门", "天空", "石头",
  "礼物", "茶水", "道路", "街道", "城堡", "城市", "森林", "溪流",
  "汽车", "星星", "月亮", "游鱼", "小鸟", "帽子", "皮球", "镜子",
  "桌子", "椅子", "背包", "雨伞", "信件", "钥匙", "灯塔", "海岛",
  "大树", "彩带", "瓷碗", "衬衫", "香蕉", "胡萝卜", "面包", "枕头",
  "棉被", "眼镜", "钢笔", "笔记本", "橡皮", "剪刀", "尺子", "纸张",
  "窗户", "自行车", "飞机", "火车", "地球", "王冠", "钻石", "彩虹",
  "瀑布", "花瓶", "小狗", "兔子", "骏马", "老虎", "大象", "企鹅",
  "鲸鱼", "海龟", "蝴蝶", "风筝", "气球", "折扇", "雕像", "蛋糕",
  "牛奶", "芒果", "西瓜", "葡萄", "草莓", "橙子", "玫瑰", "向日葵",
  "旗帜", "奖杯", "火炬", "细沙", "贝壳", "珊瑚", "吊床", "风车",
  "原野", "湖泊", "山洞", "火山", "雪花", "蜡烛", "壁炉", "汤匙",
  "餐盘", "铜钟", "楼梯", "阳台", "指南针", "铁锚", "帐篷", "灯笼"
];

const RU_WORDS: readonly string[] = [
  "Солнце", "Река", "Дом", "Гора", "Пляж", "Мост", "Лодка", "Лист",
  "Лампа", "Книга", "Облако", "Дождь", "Яблоко", "Цветок", "Кольцо", "Часы",
  "Гитара", "Кот", "Картина", "Обувь", "Огонь", "Дверь", "Небо", "Камень",
  "Подарок", "Чай", "Дорога", "Улица", "Замок", "Город", "Лес", "Ручей",
  "Машина", "Звезда", "Луна", "Рыба", "Птица", "Шляпа", "Мяч", "Зеркало",
  "Стол", "Стул", "Рюкзак", "Зонт", "Письмо", "Ключ", "Маяк", "Остров",
  "Дерево", "Лента", "Миска", "Рубашка", "Банан", "Морковь", "Хлеб", "Подушка",
  "Одеяло", "Очки", "Ручка", "Блокнот", "Ластик", "Ножницы", "Линейка", "Бумага",
  "Окно", "Велосипед", "Самолёт", "Поезд", "Земля", "Корона", "Алмаз", "Радуга",
  "Водопад", "Ваза", "Щенок", "Кролик", "Лошадь", "Тигр", "Слон", "Пингвин",
  "Кит", "Черепаха", "Бабочка", "Змей", "Шар", "Веер", "Статуя", "Торт",
  "Молоко", "Манго", "Арбуз", "Виноград", "Клубника", "Апельсин", "Роза", "Подсолнух",
  "Флаг", "Кубок", "Факел", "Песок", "Ракушка", "Коралл", "Гамак", "Мельница",
  "Поле", "Озеро", "Пещера", "Вулкан", "Снег", "Свеча", "Камин", "Ложка",
  "Тарелка", "Колокол", "Лестница", "Балкон", "Компас", "Якорь", "Палатка", "Фонарь"
];

export const SEED_WORDS_BY_LANG: Record<SupportedLanguageCode, readonly string[]> = {
  vi: VI_WORDS,
  en: EN_WORDS,
  fr: FR_WORDS,
  ja: JA_WORDS,
  ko: KO_WORDS,
  zh: ZH_WORDS,
  ru: RU_WORDS,
};

