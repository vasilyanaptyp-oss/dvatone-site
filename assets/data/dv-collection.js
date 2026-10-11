/* Named DV collection. 11.10 (round 3, job r3e): names = Viktor's bot web app «Каталог та PRO Сервіс»
   (letters/bot_catalog_1110.json, https://test.greendeer.com.ua/dv/index.html): "uk" on the Ukrainian pages, "en" on the English
   pages, always with the code. Descriptions are the earlier bot texts (unchanged). Codes with a scan but not in the bot
   (DV 006, DV 012: the bot has only DV 006.1, DV 012.1, DV 012.2) stay code-only; they are appended by the build from the scans
   (common.dv_collection()). Bot codes without a scan here are not added (no images from the bot). No prices are shown.
   Categories: assets/data/dv-categories.json (the bot's categories, they win over the computed mapping).
   Photos: "photo" below is the fallback; scans processed by _src/make_dv_photos.py (assets/data/dv-photos.json) win over it.
   DV 050 comes first (10.10, Viktor A1/A2): the catalogue opens on the delicate first-screen scan. */
window.DV_COLLECTION=[
 {
  "code": "DV 050",
  "name": {
   "en": "Roasted Coffee",
   "uk": "Обсмажена кава"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 033",
  "name": {
   "en": "Honey Cork",
   "uk": "Медова пробка"
  },
  "desc": {
   "uk": "Насичений колір із медовими нотками та текстурою пробки. Металеві відблиски додають розкоші та об’єму.",
   "en": "A rich colour with honey notes and a cork-like texture. Metallic glints add luxury and volume."
  },
  "photo": "assets/img/dv033.webp"
 },
 {
  "code": "DV 056",
  "name": {
   "en": "Silver Frost",
   "uk": "Сріблястий іній"
  },
  "desc": {
   "uk": "Холодний світло-сірий з металевим характером, нагадує колір ранкового інею або чистого алюмінію.",
   "en": "A cool light grey with a metallic character, reminiscent of morning frost or clean aluminium."
  },
  "photo": null
 },
 {
  "code": "DV 011",
  "name": {
   "en": "Ivory Cloud",
   "uk": "Хмарна слонова кістка"
  },
  "desc": {
   "uk": "Світлий відтінок з ефектом м’якої акварельної хмарності, створює легкість повітря.",
   "en": "A light shade with a soft, watercolour-like cloudiness that gives an airy lightness."
  },
  "photo": null
 },
 {
  "code": "DV 029",
  "name": {
   "en": "Nordic Storm",
   "uk": "Північний шторм"
  },
  "desc": {
   "uk": "Глибокий синьо-сірий з холодним сталевим характером, оксамитове покриття.",
   "en": "A deep blue-grey with a cool, steel-like character and a velvety finish."
  },
  "photo": null
 },
 {
  "code": "DV 010",
  "name": {
   "en": "Warm Sand",
   "uk": "Теплий пісок"
  },
  "desc": {
   "uk": "М’який бежевий відтінок із глибиною каменю, теплий, як прогрітий сонцем пісок.",
   "en": "A soft beige with the depth of stone, warm as sun-warmed sand."
  },
  "photo": null
 },
 {
  "code": "DV 004",
  "name": {
   "en": "Desert Silence",
   "uk": "Тиша пустелі"
  },
  "desc": {
   "uk": "Теплий піщаний нейтрал з ефектом візуальної тиші, спокій пустельного ранку.",
   "en": "A warm sandy neutral with a feeling of visual quiet, the calm of a desert morning."
  },
  "photo": null
 },
 {
  "code": "DV 002",
  "name": {
   "en": "Parchment White",
   "uk": "Пергаментний білий"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 015",
  "name": {
   "en": "Urban Mist",
   "uk": "Міський туман"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 018",
  "name": {
   "en": "Terra Slate",
   "uk": "Землистий сланець"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 022",
  "name": {
   "en": "Moss Garden",
   "uk": "Моховий сад"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 034",
  "name": {
   "en": "Dark Truffle",
   "uk": "Темний трюфель"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 041",
  "name": {
   "en": "Arctic Ash",
   "uk": "Арктичний попіл"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 042",
  "name": {
   "en": "Pale Silk",
   "uk": "Блідий шовк"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 043",
  "name": {
   "en": "Moonlight Dust",
   "uk": "Місячний пил"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 044",
  "name": {
   "en": "Champagne Stone",
   "uk": "Камінь Шампань"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 045",
  "name": {
   "en": "Soft Limestone",
   "uk": "М'який вапняк"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 047",
  "name": {
   "en": "Night Anthracite",
   "uk": "Нічний Антрацит"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 048",
  "name": {
   "en": "Ash Quartz",
   "uk": "Попелястий Кварц"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 049",
  "name": {
   "en": "Cool Basalt",
   "uk": "Прохолодний базальт"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 051",
  "name": {
   "en": "Deep Graphite",
   "uk": "Глибокий графіт"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 053",
  "name": {
   "en": "Soft Chrome",
   "uk": "М'який хром"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 054",
  "name": {
   "en": "Mineral Parchment",
   "uk": "Мінеральний пергамент"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 055",
  "name": {
   "en": "Urban Stone",
   "uk": "Міський камінь"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 057",
  "name": {
   "en": "Basalt Mist",
   "uk": "Базальтовий туман"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 059",
  "name": {
   "en": "Desert Rose",
   "uk": "Троянда пустелі"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 060",
  "name": {
   "en": "Pine Shadow",
   "uk": "Тінь сосни"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 061",
  "name": {
   "en": "Stone Velvet",
   "uk": "Кам'яний оксамит"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 062",
  "name": {
   "en": "Industrial Basalt",
   "uk": "Індустріальний базальт"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 063",
  "name": {
   "en": "Beige Limestone",
   "uk": "Бежевий вапняк"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 064",
  "name": {
   "en": "Sand Dune",
   "uk": "Піщана дюна"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 065",
  "name": {
   "en": "Dark Monolith",
   "uk": "Темний моноліт"
  },
  "desc": null,
  "photo": null
 },
 {
  "code": "DV 066",
  "name": {
   "en": "Deep Slate",
   "uk": "Глибокий сланець"
  },
  "desc": null,
  "photo": null
 }
];
