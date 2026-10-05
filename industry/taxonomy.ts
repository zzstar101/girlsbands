// 这个行业的分类体系：类别、标签词表、企划／乐队（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（访谈、专栏）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 live 的类别所在的节。
 *
 * 顺序即优先级：一条材料讲一件事时按这里靠前的类别归类。票务与通知优先于活动本身，
 * 因为它们才决定“会不会错过”。
 */
export const CATEGORIES = [
  { key: "notice", label: "通知", section: "重要通知", guide: "官方对已公布安排的改动与提醒：中止、延期、会场变更、开演时间变更、规则变更、补演、退款安排、注意提醒。只要材料的主体是一次安排的改变就归这里，不要因为它同时也是一次活动消息而归到活动。" },
  { key: "ticket", label: "票务", section: "票务与抽选", guide: "怎么拿到票的一切：FC 先行、Official 先行、CD／BD 封入序列号先行、抽选受理与结果、一般贩售、追加席、当日券、转售、票价、抽选券的获得方式。重点是受理期间与截止时间。商品本身是发售而非票务。" },
  { key: "live", label: "Live", section: "Live 与活动", guide: "演出与活动本身：One-man、Tour、对盘／Festival、Event、Fan Meeting、海外公演，以及新 Live 的正式公布、出演阵容、场地与日程。只讲怎么买票的归票务。" },
  { key: "release", label: "发售", section: "新作与发售", guide: "音像作品的发售：Single、Album、EP、数字发行、Blu-ray／DVD、Live 专辑，以及收录内容、初回限定版、发售日与预约开始。店铺特典归周边。" },
  { key: "merch", label: "周边", section: "周边与特典", guide: "商品与特典：Goods、限定版、店铺特典、购入特典、受注生产、会场物贩、联动商品。音像作品本身是发售。" },
  { key: "stream", label: "直播", section: "直播与影像", guide: "在线观看的一切：Live Streaming、生配信、Archive 回放、YouTube Premiere、观看期间与配信票。电视与广播节目本身是媒体。" },
  { key: "collab", label: "联动", section: "联动与活动企划", guide: "跨业合作与线下企划：联名咖啡、游戏联动、品牌合作、Pop-up Store、展览、圣地巡礼、抽奖企划。周边商品归周边。" },
  { key: "member", label: "成员", section: "成员动态", guide: "成员与出演者本人：加入、毕业、退出、活动休止与复归、出演节目、个人活动、个人发售，以及本人发布的重要告知。纯日常（吃了什么、随手拍照）没有资讯价值，判为噪声而非本类。" },
  { key: "media", label: "媒体", section: "媒体与访谈", guide: "媒体内容本身：访谈、专栏、电视、广播、杂志、Podcast、乐评、幕后花絮。版权方自己的宣传短文不算媒体内容。", commentary: true },
  { key: "other", label: "其他", section: "其他", guide: "确实属于这个企划或乐队、但落不进上面任何一类的材料：企划整体动向、商业模式、粉丝活动、行业层面的消息。无依据的传闻与转述不属于本类。" },
] as const satisfies ReadonlyArray<{ key: string; label: string; section: string; guide: string; commentary?: true }>;

/**
 * 筛选栏“来源”一栏的说法。key 由框架固定：news 是抓来的报道，x 是 X 上的帖子，firstParty 是 T1 官方一手源。
 * 换行业时只改说法，不要改 key。X 上的内容只是线索，官方一手源才是“官方确认”的依据。
 */
export const CHANNEL_LABELS = {
  all: "全部",
  news: "情报",
  x: "X",
  firstParty: "官方",
} as const;

/**
 * 能描述一场演出本身的类别：演出公告与它的票务公告。生放送（stream）、展览与快闪店（collab）不是演出，
 * 不会被建成一场 Live。演出信息的抽取与 Live 身份的推导都按这一条设门（见 editorial/analyze.ts 与 lives/link.ts）。
 */
export const LIVE_CATEGORIES: ReadonlySet<string> = new Set(["live", "ticket"]);

/**
 * 分类标签里属于一条「发售链」的两端：音像作品（一张碟本身）与商品特典（版本、店铺特典、序列号）。
 * 发售链的抽取与 releases/derive.ts 的推导都按这两条设门，词表与 CATEGORY_TAGS 里那七个写法逐字一致。
 */
export const RELEASE_TAGS: ReadonlySet<string> = new Set(["新作发售", "初回限定盘", "数字发行", "Blu-ray/DVD"]);

export const MERCH_TAGS: ReadonlySet<string> = new Set(["周边商品", "店铺特典", "联名商品"]);

/**
 * 这个行业最受关注的一类发布（日报报头的计数、改分类后修订已出的报告、编年史的上面一行都按它数）。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。没有这样一类的行业设成 null。
 * 本行业取“票务”：开售与抽选是粉丝最需要第一时间知道的事。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "ticket", tag: "开售/抽选", unit: "条票务消息" };

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["live", "bd", "cd", "fc", "mv", "ototoy"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。一类对应一个类别。
 */
export const ITEM_TYPES = [
  "live_announcement", "ticket_info", "release_news", "merch_bonus", "stream_info",
  "collab_event", "media_content", "member_update", "official_notice", "other",
] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "开售/抽选", "一般贩售", "追加席", "当日券", "转售", "抽选结果",
  "新 Live", "海外公演", "对盘/Festival", "出演阵容",
  "新作发售", "初回限定盘", "数字发行", "Blu-ray/DVD",
  "周边商品", "店铺特典", "联名商品",
  "直播/生配信", "Archive 回放", "联动企划", "线下活动",
  "成员动态", "加入/毕业", "活动休止/复归",
  "中止/延期", "会场/日程变更", "规则变更", "官方提醒",
  "媒体访谈", "电视/广播", "杂志/专栏",
  "其他",
] as const;

/** 可选的主题标签（按行为与场合分）。 */
export const TOPIC_TAGS = [
  "One-man", "Tour", "对盘", "Festival", "Fan Meeting", "海外",
  "抽选", "先行", "一般贩售", "追加席", "当日券", "转售", "序列号",
  "Single", "Album", "EP", "数字发行", "Blu-ray", "Live 专辑", "MV",
  "限定版", "店铺特典", "受注生产", "场贩", "联动", "咖啡", "展览", "游戏联动",
  "生配信", "Archive", "YouTube", "电视", "广播", "杂志", "Podcast",
  "声优", "乐手", "制作人", "Staff",
] as const;

/** 可选的实体标签（企划、乐队、场馆、票务平台、商店、媒体）。 */
export const ENTITY_TAGS = [
  "GIRLS BAND CRY", "トゲナシトゲアリ", "BanG Dream!", "MyGO!!!!!", "Ave Mujica", "Roselia", "結束バンド", "ぼっち・ざ・ろっく！",
  "Poppin'Party", "Afterglow", "Pastel*Palettes", "ハロー、ハッピーワールド！", "Morfonica", "RAISE A SUILEN",
  "夢限大みゅーたいぷ", "Our Notes", "millsage", "一家Dumb Rock!", "クズミミズク", "ダイヤモンドダスト",
  "Zepp", "TOKYO DOME CITY HALL", "日本武道館", "ぴあアリーナMM", "Kアリーナ横浜", "有明アリーナ", "LINE CUBE SHIBUYA",
  "e+", "チケットぴあ", "ローソンチケット", "イープラス", "Animate", "Gamers", "Tower Records", "HMV", "Limista",
  "音楽ナタリー", "Animate Times", "LisAni!", "Billboard Japan", "ORICON",
] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  // 票务
  "先行抽选": "开售/抽选", 先行: "开售/抽选", 抽选: "开售/抽选", 抽選: "开售/抽选", 受付: "开售/抽选", 受理: "开售/抽选",
  先行受付: "开售/抽选", fc先行: "开售/抽选", "FC先行": "开售/抽选", 官方先行: "开售/抽选",
  一般发售: "一般贩售", 一般販売: "一般贩售", 一般销售: "一般贩售", 公开发售: "一般贩售", 一般発売: "一般贩售",
  追加席: "追加席", 追加座位: "追加席", 追加公演席: "追加席", 见切席: "追加席",
  当日券: "当日券", 当日票: "当日券",
  转售: "转售", 转让: "转售", リセール: "转售", 定價轉讓: "转售",
  抽选结果: "抽选结果", 当选: "抽选结果", 落选: "抽选结果", 当選: "抽选结果",
  // Live
  "新 live": "新 Live", 新live: "新 Live", "live 公布": "新 Live", 演出公布: "新 Live", 公演公布: "新 Live", ワンマン: "新 Live",
  海外: "海外公演", 海外演出: "海外公演", 亚洲巡演: "海外公演", アジアツアー: "海外公演",
  对盘: "对盘/Festival", 対バン: "对盘/Festival", 音乐节: "对盘/Festival", フェス: "对盘/Festival", festival: "对盘/Festival",
  出演阵容: "出演阵容", 阵容: "出演阵容", 追加出演: "出演阵容",
  // 发售
  新作: "新作发售", 发售: "新作发售", 发行: "新作发售", リリース: "新作发售", 单曲: "新作发售", 专辑: "新作发售",
  初回限定: "初回限定盘", 初回限定版: "初回限定盘", 限定盘: "初回限定盘", 特装盘: "初回限定盘",
  数字发行: "数字发行", 数字版: "数字发行", 配信リリース: "数字发行", 流媒体发行: "数字发行",
  "blu-ray": "Blu-ray/DVD", bd: "Blu-ray/DVD", dvd: "Blu-ray/DVD", 蓝光: "Blu-ray/DVD",
  // 周边
  周边: "周边商品", 商品: "周边商品", グッズ: "周边商品", goods: "周边商品", 物贩: "周边商品",
  店铺特典: "店铺特典", 店特: "店铺特典", 特典: "店铺特典", 购入特典: "店铺特典", 先着特典: "店铺特典",
  联名商品: "联名商品", 联动商品: "联名商品", コラボグッズ: "联名商品",
  // 直播
  直播: "直播/生配信", 生放送: "直播/生配信", 生配信: "直播/生配信", 配信: "直播/生配信", 演唱会直播: "直播/生配信",
  archive: "Archive 回放", 回放: "Archive 回放", アーカイブ: "Archive 回放", 见逃: "Archive 回放",
  // 联动 / 活动
  联动: "联动企划", コラボ: "联动企划", 合作: "联动企划", 联名: "联动企划",
  线下活动: "线下活动", 展览: "线下活动", 展示会: "线下活动", popup: "线下活动", 快闪店: "线下活动", 咖啡: "线下活动",
  // 成员
  成员: "成员动态", メンバー: "成员动态", 个人活动: "成员动态", 出演: "成员动态",
  加入: "加入/毕业", 毕业: "加入/毕业", 卒業: "加入/毕业", 退出: "加入/毕业", 脱退: "加入/毕业", 新成员: "加入/毕业",
  休止: "活动休止/复归", 活动休止: "活动休止/复归", 复归: "活动休止/复归", 復帰: "活动休止/复归", 回归: "活动休止/复归", 暂停活动: "活动休止/复归",
  // 通知
  中止: "中止/延期", 取消: "中止/延期", 延期: "中止/延期", 公演中止: "中止/延期",
  会场变更: "会场/日程变更", 场地变更: "会场/日程变更", 日程变更: "会场/日程变更", 时间变更: "会场/日程变更", 振替: "会场/日程变更",
  规则变更: "规则变更", 规定变更: "规则变更", 注意唤起: "官方提醒", 提醒: "官方提醒", 须知: "官方提醒",
  // 媒体
  访谈: "媒体访谈", 采访: "媒体访谈", インタビュー: "媒体访谈", 对谈: "媒体访谈", コラム: "杂志/专栏", 专栏: "杂志/专栏",
  电视: "电视/广播", tv: "电视/广播", 广播: "电视/广播", ラジオ: "电视/广播",
  杂志: "杂志/专栏", 雑誌: "杂志/专栏", podcast: "杂志/专栏", ポッドキャスト: "杂志/专栏",
  // 主题
  "ワンマンライブ": "One-man", oneman: "One-man", 巡演: "Tour", ツアー: "Tour",
  フェスティバル: "Festival", 音乐祭: "Festival",
  シリアル: "序列号", serial: "序列号", 序列码: "序列号", シリアルコード: "序列号",
  シングル: "Single", アルバム: "Album", ミニアルバム: "EP", mv: "MV", ミュージックビデオ: "MV",
  初回限定盤: "限定版", 受注生産: "受注生产", カフェ: "咖啡", 展覧会: "展览", ゲーム: "游戏联动",
  声優: "声优", 楽器隊: "乐手", ギタリスト: "乐手", プロデューサー: "制作人", スタッフ: "Staff",
  // 其他
  动态: "其他", 消息: "其他", 综上: "其他",
};

// ── 企划与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 企划／乐队主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名、该乐队自己的强调色。
 * accent 只用在强调线、下划线、标签、hover 与光晕上，永远不整页染色；它是数据，不是组件里的常量。
 * aliases 给结构抽取模型看；otherNames 是这个主体自己的其他称呼（官方账号名、子品牌、中文译名、
 * 粉丝俗称），把事实的主体对到发布方时也认它们。加乐队只加在这里和 topics.json，不要写进代码。
 *
 * accent 取的是**官方值**，不是我们调过的近似色：12 支 BanG Dream! 乐队抄自 bang-dream.com 官方样式表
 * （`.p-artist-list__item--<slug> .p-artist-list__item-image:before{background:…}`），GIRLS BAND CRY
 * 用官网页脚那条通栏红 `#f40000`，BanG Dream! 企划用字标墨色 `#e4004f`，クズミミズク 用
 * gbc-firstriff.com 的 `--c-band4`，ぼっち・ざ・ろっく 用 bocchi.rocks 根站（劇場総集編）
 * `omnibus/assets/css/common.css` 的主色 `#c45aff`；トゲナシトゲアリ、Our Notes、ダイヤモンドダスト
 * 三支官方没有公开声明过队色，沿用我们原先的值。改色前先核官方样式表，别凭印象调。
 *
 * kind 是硬边界，不是标签：`project` 是整个系列、单部作品、游戏本身（BanG Dream!、GIRLS BAND CRY、
 * Our Notes、ぼっち・ざ・ろっく！），它们当然会被报道、也该有主题页、也能订阅，但**不是一支乐队**——
 * 订阅页要把两组分开写，头图主角优先取 `band`，免得"订了 BanG Dream! 这个企划"却拿企划字标去讲某支乐队的 Live。
 * 新增条目必须写 kind，漏写会被类型检查拦住。系列归属写在下面的 SERIES 里。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[]; accent?: string; kind: "band" | "project" }> = {
  "girls-band-cry": {
    accent: "#f40000",
    kind: "project",
    name: "GIRLS BAND CRY",
    displayTag: "GIRLS BAND CRY",
    aliases: ["GIRLS BAND CRY", "ガールズバンドクライ", "少女乐队哭泣", "GBC"],
    otherNames: ["ガールズバンドクライ", "GBC", "Girls Band Cry"],
  },
  "togenashi-togeari": {
    accent: "#ff2d3f",
    kind: "band",
    name: "トゲナシトゲアリ",
    displayTag: "トゲナシトゲアリ",
    aliases: ["トゲナシトゲアリ", "Togenashi Togeari", "トゲトゲ", "TGTG", "刺刺"],
    otherNames: ["トゲナシトゲアリ", "Togenashi Togeari", "トゲトゲ", "TGTG"],
  },
  "bang-dream": {
    accent: "#e4004f",
    kind: "project",
    name: "BanG Dream!",
    displayTag: "BanG Dream!",
    aliases: ["BanG Dream!", "バンドリ", "邦邦"],
    otherNames: ["BanG Dream!", "バンドリ！", "バンドリ", "BanG Dream"],
  },
  "mygo": {
    accent: "#3388bb",
    kind: "band",
    name: "MyGO!!!!!",
    displayTag: "MyGO!!!!!",
    aliases: ["MyGO!!!!!", "MyGO", "マイゴ", "迷子"],
    otherNames: ["MyGO!!!!!", "MyGO", "マイゴ"],
  },
  "ave-mujica": {
    accent: "#881144",
    kind: "band",
    name: "Ave Mujica",
    displayTag: "Ave Mujica",
    aliases: ["Ave Mujica", "アヴェムジカ", "AveMujica"],
    otherNames: ["Ave Mujica", "アヴェムジカ"],
  },
  roselia: {
    accent: "#7082cc",
    kind: "band",
    name: "Roselia",
    displayTag: "Roselia",
    aliases: ["Roselia", "ロゼリア"],
    otherNames: ["Roselia", "ロゼリア"],
  },
  // 結束バンド 是《ぼっち・ざ・ろっく！》里的乐队；作品本身是下面那条 bocchi-the-rock 企划。
  // 两者必须分开：作品的消息（动画、剧场版、联动）不是乐队的消息，乐队页也不该收作品新闻。
  "kessoku-band": {
    accent: "#e0a13a",
    kind: "band",
    name: "結束バンド",
    displayTag: "結束バンド",
    aliases: ["結束バンド", "结束乐队", "Kessoku Band"],
    otherNames: ["結束バンド", "Kessoku Band"],
  },
  "bocchi-the-rock": {
    accent: "#c45aff",
    kind: "project",
    name: "ぼっち・ざ・ろっく！",
    displayTag: "ぼっち・ざ・ろっく！",
    aliases: ["ぼっち・ざ・ろっく！", "ぼざろ", "Bocchi the Rock!"],
    otherNames: ["ぼっち・ざ・ろっく！", "ぼざろ", "Bocchi the Rock!"],
  },
  // BanG Dream! 企划内的乐队。综合站 bang-dream.com 一条就能覆盖它们，但它们各自的 Live、抽选、
  // 发售要能被单独追踪，所以每支都要有自己的实体、标签和主题页（只加在这里和 topics.json）。
  poppinparty: {
    accent: "#ff3b72",
    kind: "band",
    name: "Poppin'Party",
    displayTag: "Poppin'Party",
    aliases: ["Poppin'Party", "ポッピンパーティ", "ポピパ"],
    otherNames: ["Poppin'Party", "ポッピンパーティ", "ポピパ"],
  },
  afterglow: {
    accent: "#ee3344",
    kind: "band",
    name: "Afterglow",
    displayTag: "Afterglow",
    aliases: ["Afterglow", "アフターグロウ"],
    otherNames: ["Afterglow", "アフターグロウ"],
  },
  "pastel-palettes": {
    accent: "#0ad99b",
    kind: "band",
    name: "Pastel*Palettes",
    displayTag: "Pastel*Palettes",
    aliases: ["Pastel*Palettes", "Pastel Palettes", "パステルパレット"],
    otherNames: ["Pastel*Palettes", "パステルパレット"],
  },
  "hello-happy-world": {
    accent: "#ffb800",
    kind: "band",
    name: "ハロー、ハッピーワールド！",
    displayTag: "ハロー、ハッピーワールド！",
    aliases: ["ハロー、ハッピーワールド！", "ハロハピ", "Hello, Happy World!"],
    otherNames: ["ハロー、ハッピーワールド！", "ハロハピ", "Hello, Happy World!"],
  },
  morfonica: {
    accent: "#33aaff",
    kind: "band",
    name: "Morfonica",
    displayTag: "Morfonica",
    aliases: ["Morfonica", "モルフォニカ"],
    otherNames: ["Morfonica", "モルフォニカ"],
  },
  "raise-a-suilen": {
    accent: "#0dc5c5",
    kind: "band",
    name: "RAISE A SUILEN",
    displayTag: "RAISE A SUILEN",
    aliases: ["RAISE A SUILEN", "レイズアスイレン", "RAS"],
    otherNames: ["RAISE A SUILEN", "レイズアスイレン", "RAS"],
  },
  "mugendai-mewtype": {
    accent: "#ec7384",
    kind: "band",
    name: "夢限大みゅーたいぷ",
    displayTag: "夢限大みゅーたいぷ",
    aliases: ["夢限大みゅーたいぷ", "夢限大みゅーたいふ"],
    otherNames: ["夢限大みゅーたいぷ"],
  },
  "our-notes": {
    accent: "#3f9e91",
    kind: "project",
    name: "Our Notes",
    displayTag: "Our Notes",
    aliases: ["Our Notes"],
    otherNames: ["Our Notes"],
  },
  millsage: {
    accent: "#aa22ee",
    kind: "band",
    name: "millsage",
    displayTag: "millsage",
    aliases: ["millsage"],
    otherNames: ["millsage"],
  },
  ikkadumbrock: {
    accent: "#ffaa33",
    kind: "band",
    name: "一家Dumb Rock!",
    displayTag: "一家Dumb Rock!",
    aliases: ["一家Dumb Rock!", "一家Dumb Rock"],
    otherNames: ["一家Dumb Rock!"],
  },
  // GIRLS BAND CRY 侧的乐队：游戏 First Riff 的三支新乐队（第 1～3 弾），以及动画里的对手乐队。
  "canna-lily": {
    accent: "#e8629a",
    kind: "band",
    name: "Canna Lily",
    displayTag: "Canna Lily",
    aliases: ["Canna Lily", "CannaLily"],
    otherNames: ["Canna Lily"],
  },
  "f-272": {
    accent: "#2fbf9b",
    kind: "band",
    name: "F-272",
    displayTag: "F-272",
    aliases: ["F-272", "F272"],
    otherNames: ["F-272"],
  },
  kuzumimizuku: {
    accent: "#73a792",
    kind: "band",
    name: "クズミミズク",
    displayTag: "クズミミズク",
    aliases: ["クズミミズク"],
    otherNames: ["クズミミズク"],
  },
  "diamond-dust": {
    accent: "#58a6c9",
    kind: "band",
    name: "ダイヤモンドダスト",
    displayTag: "ダイヤモンドダスト",
    aliases: ["ダイヤモンドダスト"],
    otherNames: ["ダイヤモンドダスト"],
  },
};

/** 乐队 id：`kind === "band"` 的全部条目，顺序就是配置里的顺序。订阅、头图、乐队页只认这批。 */
export const BAND_IDS: readonly string[] = Object.keys(ENTITIES).filter((id) => ENTITIES[id]!.kind === "band");

/** 企划／作品 id：整个系列、单部作品、游戏本身。能被报道、能有主题页，但不是一支乐队。 */
export const PROJECT_IDS: readonly string[] = Object.keys(ENTITIES).filter((id) => ENTITIES[id]!.kind === "project");

/** 这个 id 是不是一支乐队；不认识的 id 一律不是。 */
export function isBand(id: string): boolean {
  return ENTITIES[id]?.kind === "band";
}

/** 这个 id 是不是一个企划／作品；不认识的 id 一律不是。 */
export function isProject(id: string): boolean {
  return ENTITIES[id]?.kind === "project";
}

/**
 * 系列：一个一级企划下面挂了哪些主体（企划自己也算一个）。企划页要把旗下乐队的消息一起收进来，靠的就是它 ——
 * topics.json 里每个主体的归类标签会展开成「自己 + 同系列的其它主体」，标题匹配也带上整组的名字。
 * 一支乐队不属于任何系列时不用写在这里（它自己就是一组）。
 *
 * our-notes 是 BanG Dream! 系列里的游戏，所以它跟 12 支乐队同组；但首页与导航只列 FRANCHISES 那三个
 * 一级企划 —— 游戏不是粉丝认路时用的坐标。
 */
const SERIES: ReadonlyArray<{ id: string; members: readonly string[] }> = [
  {
    id: "bang-dream",
    members: [
      "bang-dream", "poppinparty", "afterglow", "roselia", "pastel-palettes", "hello-happy-world",
      "morfonica", "raise-a-suilen", "mygo", "ave-mujica", "mugendai-mewtype", "millsage", "ikkadumbrock", "our-notes",
    ],
  },
  { id: "girls-band-cry", members: ["girls-band-cry", "togenashi-togeari", "canna-lily", "f-272", "kuzumimizuku", "diamond-dust"] },
  { id: "bocchi-the-rock", members: ["bocchi-the-rock", "kessoku-band"] },
];

/** 首页与导航列出的一级企划，顺序就是这里的顺序。 */
export const FRANCHISES: readonly string[] = SERIES.map((s) => s.id);

/**
 * 这个页面该收哪些主体的消息：企划页（系列 id 就是企划自己）收整个系列，乐队页只收它自己。
 * 归类标签、标题匹配、日历与 .ics 的 subject 都用它 —— 乐队页不能被同系列其他乐队的消息串进来，
 * 所以这里只认「这个 id 自己是不是系列 id」，不做成员反查（那是 seriesKeyOf 的事）。
 */
export function seriesOf(id: string): readonly string[] {
  return SERIES.find((s) => s.id === id)?.members ?? (ENTITIES[id] ? [id] : []);
}

/** 这个主体属于哪个系列（企划自己的 id 就是系列 id）；不认识的 id 返回 null。 */
export function seriesKeyOf(id: string): string | null {
  return SERIES.find((s) => s.members.includes(id))?.id ?? (ENTITIES[id] ? id : null);
}

/**
 * 身份词典：摘要和标题里出现的企划／乐队，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。缩写（GBC／TGTG）容易误伤，只认独立的拉丁字母串或日文原名的连续写法。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "girls-band-cry", name: "GIRLS BAND CRY", patterns: [/girls\s?band\s?cry|ガールズバンドクライ|\bGBC\b/i] },
  { id: "togenashi-togeari", name: "トゲナシトゲアリ", patterns: [/トゲナシトゲアリ|togenashi|\bTGTG\b|トゲトゲ/i] },
  { id: "bang-dream", name: "BanG Dream!", patterns: [/ban\s?g\s?dream|バンドリ/i] },
  { id: "mygo", name: "MyGO!!!!!", patterns: [/my\s?go|マイゴ/i] },
  { id: "ave-mujica", name: "Ave Mujica", patterns: [/ave\s?mujica|アヴェムジカ|アヴェ・ムジカ/i] },
  { id: "roselia", name: "Roselia", patterns: [/roselia|ロゼリア/i] },
  { id: "kessoku-band", name: "結束バンド", patterns: [/結束バンド|kessoku\s?band/i] },
  { id: "bocchi-the-rock", name: "ぼっち・ざ・ろっく！", patterns: [/ぼっち・ざ・ろっく|ぼざろ|bocchi\s?the\s?rock/i] },
  { id: "poppinparty", name: "Poppin'Party", patterns: [/poppin'?\s?party|ポッピンパーティ|ポピパ/i] },
  { id: "afterglow", name: "Afterglow", patterns: [/afterglow|アフターグロウ/i] },
  { id: "pastel-palettes", name: "Pastel*Palettes", patterns: [/pastel\s?\*?\s?palettes|パステルパレット/i] },
  { id: "hello-happy-world", name: "ハロー、ハッピーワールド！", patterns: [/ハロー[、,]?\s?ハッピーワールド|ハロハピ|hello,?\s?happy\s?world/i] },
  { id: "morfonica", name: "Morfonica", patterns: [/morfonica|モルフォニカ/i] },
  { id: "raise-a-suilen", name: "RAISE A SUILEN", patterns: [/raise\s?a\s?suilen|レイズアスイレン/i] },
  { id: "mugendai-mewtype", name: "夢限大みゅーたいぷ", patterns: [/夢限大みゅーたいぷ|夢限大/i] },
  { id: "our-notes", name: "Our Notes", patterns: [/our\s?notes/i] },
  { id: "millsage", name: "millsage", patterns: [/millsage/i] },
  { id: "ikkadumbrock", name: "一家Dumb Rock!", patterns: [/一家\s?dumb\s?rock/i] },
  { id: "canna-lily", name: "Canna Lily", patterns: [/canna\s?lily/i] },
  { id: "f-272", name: "F-272", patterns: [/\bf[-\s]?272\b/i] },
  { id: "kuzumimizuku", name: "クズミミズク", patterns: [/クズミミズク/i] },
  { id: "diamond-dust", name: "ダイヤモンドダスト", patterns: [/ダイヤモンドダスト/i] },
];

/**
 * 身份线索：原文里只有账号名或固定说法时，也能认定它讲的是哪个企划／乐队。
 * 这些写法短、容易误伤，所以只在“整段材料”里匹配一次，且要求带上 @ 或词组本身足够特别。
 * 只写核实过的官方账号；核实之前留空数组，识别就退回 IDENTITY_LEXICON 里的名称匹配。
 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
];

/** 这些域名上的文章，发布方就是对应的主体（票务平台与商店不算，它们只是售卖渠道）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "girls-band-cry", domains: ["girls-band-cry.com"] },
  { entityId: "togenashi-togeari", domains: ["togenashitogeari.com"] },
  { entityId: "bang-dream", domains: ["bang-dream.com", "bang-dream.bushimo.jp"] },
  { entityId: "mygo", domains: ["mygo.bang-dream.com"] },
  { entityId: "ave-mujica", domains: ["avemujica.bang-dream.com"] },
  { entityId: "roselia", domains: ["roselia.bang-dream.com"] },
  // bocchi.rocks 是整个作品（动画、劇場総集編、乐队）的官方站，所以发布方算作品；乐队自己的信息页
  // 由信源的 owner_entity_id 带出 結束バンド，两条路都在 identityContext 的 allowed 里。
  { entityId: "bocchi-the-rock", domains: ["bocchi.rocks"] },
];
