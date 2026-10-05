// 角色页（/member/<id>）的真源：角色名的写法、所属乐队、担当、声优、同页别名。
//
// 生成脚本：node .data/build-glossary-tables.ts（.data/ 不进仓库，生成出来的这份进仓库）。
// 2026-10-05 研究产出，每个名字的来源写在 .data/glossary-members.tsv 的备注列；
// forms 与 industry/glossary-members.ts 里对应条目逐条相同（tests/members.test.ts 会核对，防两份数据漂移）。
//
// - id 取官方罗马字（Canna Lily / F-272 没有官方罗马字，按官网罗马字读法拼）；
// - band 是 ENTITIES 的乐队 id —— 成员不是抓取主体，不单独进平台，只在角色页与 `/members` 上出现；
// - aliases 是并进这一页的别名（Ave Mujica 的舞台代号、Hello, Happy World! 的米歇尔）；
// - actor 是声优，VTuber 乐队（Mugendai Mewtype）角色名与本人同名，这里就是同一个名字。
export interface MemberActor {
  /** 声优名的写法，第一个是本站倾向使用的写法 */
  readonly forms: readonly string[];
  /** 担当（Vo./Gt./Key./Ba./Dr./DJ&Mp.），官方写明的才有 */
  readonly role?: string;
}

export interface MemberEntity {
  /** URL 用：/member/<id> */
  readonly id: string;
  /** 所属乐队：ENTITIES 的 id */
  readonly band: string;
  /** 角色名的写法，第一个是本站倾向使用的写法 */
  readonly forms: readonly string[];
  /** 担当（Vo./Gt./Key./Ba./Dr./DJ&Mp.），官方写明的才有 */
  readonly role?: string;
  /** 同一页的别名（舞台代号、演出用身份），第一个写法是倾向写法 */
  readonly aliases: readonly (readonly string[])[];
  /** 声优 */
  readonly actor: MemberActor;
}

export const MEMBER_ENTITIES: readonly MemberEntity[] = [
  { id: "nina-iseri", band: "togenashi-togeari", forms: ["井芹仁菜", "いせりにな", "Nina Iseri"], role: "Vo.", aliases: [], actor: { forms: ["理名", "りな", "Rina"] } },
  { id: "momoka-kawaragi", band: "togenashi-togeari", forms: ["河原木桃香", "かわらぎももか", "Momoka Kawaragi"], role: "Gt.", aliases: [], actor: { forms: ["夕莉", "ゆうり", "Yuri"] } },
  { id: "subaru-awa", band: "togenashi-togeari", forms: ["安和昴", "安和すばる", "あわすばる", "Subaru Awa"], role: "Dr.", aliases: [], actor: { forms: ["美怜", "みれい", "Mirei"] } },
  { id: "tomo-ebizuka", band: "togenashi-togeari", forms: ["海老塚智", "えびづかとも", "Tomo Ebizuka"], role: "Key.", aliases: [], actor: { forms: ["凪都", "なつ", "Natsu"] } },
  { id: "rupa", band: "togenashi-togeari", forms: ["卢帕", "ルパ", "露帕", "るぱ", "Rupa"], role: "Ba.", aliases: [], actor: { forms: ["朱李", "しゅり", "Shuri"] } },
  { id: "tomori-takamatsu", band: "mygo", forms: ["高松灯", "高松燈", "たかまつともり", "Tomori Takamatsu"], role: "Vo.", aliases: [], actor: { forms: ["羊宮妃那", "ようみやひな", "Yomiya Hina"] } },
  { id: "anon-chihaya", band: "mygo", forms: ["千早爱音", "千早愛音", "ちはやあのん", "Anon Chihaya"], role: "Gt.", aliases: [], actor: { forms: ["立石凛", "たていしりん", "Tateishi Rin"] } },
  { id: "rana-kaname", band: "mygo", forms: ["要乐奈", "要楽奈", "かなめらな", "Rana Kaname"], role: "Gt.", aliases: [], actor: { forms: ["青木陽菜", "あおきひな", "Aoki Hina"] } },
  { id: "soyo-nagasaki", band: "mygo", forms: ["长崎爽世", "長崎そよ", "ながさきそよ", "Soyo Nagasaki"], role: "Ba.", aliases: [], actor: { forms: ["小日向美香", "こひなたみか", "Kohinata Mika"] } },
  { id: "taki-shiina", band: "mygo", forms: ["椎名立希", "しいなたき", "Taki Shiina"], role: "Dr.", aliases: [], actor: { forms: ["林鼓子", "はやしここ", "Hayashi Koko"] } },
  { id: "sakiko-togawa", band: "ave-mujica", forms: ["丰川祥子", "豊川祥子", "とがわさきこ", "Sakiko Togawa"], role: "Key.", aliases: [["Oblivionis", "オブリビオニス"]], actor: { forms: ["高尾奏音", "たかおかのん", "Takao Kanon"] } },
  { id: "mutsumi-wakaba", band: "ave-mujica", forms: ["若叶睦", "若葉睦", "わかばむつみ", "Mutsumi Wakaba"], role: "Gt.", aliases: [["Mortis", "モーティス"]], actor: { forms: ["渡瀬結月", "わたせゆづき", "Watase Yuzuki"] } },
  { id: "uika-misumi", band: "ave-mujica", forms: ["三角初华", "三角初華", "みすみういか", "Uika Misumi"], role: "Gt./Vo.", aliases: [["Doloris", "ドロリス", "Dolores"]], actor: { forms: ["佐々木李子", "ささきりこ", "Sasaki Riko"] } },
  { id: "umiri-yahata", band: "ave-mujica", forms: ["八幡海铃", "八幡海鈴", "やはたうみり", "Umiri Yahata"], role: "Ba.", aliases: [["Timoris", "ティモリス"]], actor: { forms: ["岡田夢以", "おかだめい", "Okada Mei"] } },
  { id: "nyamu-yutenji", band: "ave-mujica", forms: ["祐天寺若麦", "祐天寺にゃむ", "ゆうてんじにゃむ", "Nyamu Yutenji"], role: "Dr.", aliases: [["Amoris", "アモーリス"]], actor: { forms: ["米澤茜", "よねざわあかね", "Yonezawa Akane"] } },
  { id: "yukina-minato", band: "roselia", forms: ["凑友希那", "湊友希那", "みなとゆきな", "Yukina Minato"], role: "Vo.", aliases: [], actor: { forms: ["相羽あいな", "あいばあいな", "Aiba Aina"] } },
  { id: "sayo-hikawa", band: "roselia", forms: ["冰川纱夜", "氷川紗夜", "ひかわさよ", "Sayo Hikawa"], role: "Gt.", aliases: [], actor: { forms: ["工藤晴香", "くどうはるか", "Kudo Haruka"] } },
  { id: "lisa-imai", band: "roselia", forms: ["今井莉莎", "今井リサ", "いまいりさ", "Lisa Imai"], role: "Ba.", aliases: [], actor: { forms: ["中島由貴", "なかしまゆき", "Nakashima Yuki"] } },
  { id: "ako-udagawa", band: "roselia", forms: ["宇田川亚子", "宇田川あこ", "うだがわあこ", "Ako Udagawa"], role: "Dr.", aliases: [], actor: { forms: ["櫻川めぐ", "さくらがわめぐ", "Sakuragawa Megu"] } },
  { id: "rinko-shirokane", band: "roselia", forms: ["白金燐子", "しろかねりんこ", "Rinko Shirokane"], role: "Key.", aliases: [], actor: { forms: ["志崎樺音", "しざきかのん", "Shizaki Kanon"] } },
  { id: "hitori-gotoh", band: "kessoku-band", forms: ["后藤一里", "後藤ひとり", "ごとうひとり", "Hitori Gotoh"], role: "Gt.", aliases: [], actor: { forms: ["青山吉能", "あおやまよしの", "Aoyama Yoshino"] } },
  { id: "nijika-ijichi", band: "kessoku-band", forms: ["伊地知虹夏", "いじちにじか", "Nijika Ijichi"], role: "Dr.", aliases: [], actor: { forms: ["鈴代紗弓", "すずしろさゆみ", "Suzushiro Sayumi"] } },
  { id: "ryo-yamada", band: "kessoku-band", forms: ["山田凉", "山田リョウ", "やまだリョウ", "Ryo Yamada"], role: "Ba.", aliases: [], actor: { forms: ["水野朔", "みずのさく", "Mizuno Saku"] } },
  { id: "ikuyo-kita", band: "kessoku-band", forms: ["喜多郁代", "きたいくよ", "Ikuyo Kita"], role: "Gt./Vo.", aliases: [], actor: { forms: ["長谷川育美", "はせがわいくみ", "Hasegawa Ikumi"] } },
  { id: "kasumi-toyama", band: "poppinparty", forms: ["户山香澄", "戸山香澄", "とやまかすみ", "Kasumi Toyama"], role: "Gt./Vo.", aliases: [], actor: { forms: ["愛美", "あいみ", "Aimi"] } },
  { id: "tae-hanazono", band: "poppinparty", forms: ["花园多惠", "花園たえ", "はなぞのたえ", "Tae Hanazono"], role: "Gt.", aliases: [], actor: { forms: ["大塚紗英", "おおつかさえ", "Otsuka Sae"] } },
  { id: "rimi-ushigome", band: "poppinparty", forms: ["牛込里美", "牛込りみ", "うしごめりみ", "Rimi Ushigome"], role: "Ba.", aliases: [], actor: { forms: ["西本りみ", "にしもとりみ", "Nishimoto Rimi"] } },
  { id: "saya-yamabuki", band: "poppinparty", forms: ["山吹沙绫", "山吹沙綾", "やまぶきさあや", "Saya Yamabuki"], role: "Dr.", aliases: [], actor: { forms: ["大橋彩香", "おおはしあやか", "Ohashi Ayaka"] } },
  { id: "arisa-ichigaya", band: "poppinparty", forms: ["市谷有咲", "市ヶ谷有咲", "いちがやありさ", "Arisa Ichigaya"], role: "Key.", aliases: [], actor: { forms: ["伊藤彩沙", "いとうあやさ", "Ito Ayasa"] } },
  { id: "ran-mitake", band: "afterglow", forms: ["美竹兰", "美竹蘭", "みたけらん", "Ran Mitake"], role: "Gt./Vo.", aliases: [], actor: { forms: ["佐倉綾音", "さくらあやね", "Sakura Ayane"] } },
  { id: "moca-aoba", band: "afterglow", forms: ["青叶摩卡", "青葉モカ", "あおばモカ", "Moca Aoba"], role: "Gt.", aliases: [], actor: { forms: ["三澤紗千香", "みさわさちか", "Misawa Sachika"] } },
  { id: "himari-uehara", band: "afterglow", forms: ["上原绯玛丽", "上原ひまり", "うえはらひまり", "Himari Uehara"], role: "Ba.", aliases: [], actor: { forms: ["加藤英美里", "かとうえみり", "Kato Emiri"] } },
  { id: "tomoe-udagawa", band: "afterglow", forms: ["宇田川巴", "うだがわともえ", "Tomoe Udagawa"], role: "Dr.", aliases: [], actor: { forms: ["日笠陽子", "ひかさようこ", "Hikasa Yoko"] } },
  { id: "tsugumi-hazawa", band: "afterglow", forms: ["羽泽鸫", "羽沢つぐみ", "はざわつぐみ", "Tsugumi Hazawa"], role: "Key.", aliases: [], actor: { forms: ["金元寿子", "かねもとひさこ", "Kanemoto Hisako"] } },
  { id: "aya-maruyama", band: "pastel-palettes", forms: ["丸山彩", "まるやまあや", "Aya Maruyama"], role: "Vo.", aliases: [], actor: { forms: ["前島亜美", "まえじまあみ", "Maejima Ami"] } },
  { id: "hina-hikawa", band: "pastel-palettes", forms: ["冰川日菜", "氷川日菜", "ひかわひな", "Hina Hikawa"], role: "Gt.", aliases: [], actor: { forms: ["小澤亜李", "おざわあり", "Ozawa Ari"] } },
  { id: "chisato-shirasagi", band: "pastel-palettes", forms: ["白鹭千圣", "白鷺千聖", "しらさぎちさと", "Chisato Shirasagi"], role: "Ba.", aliases: [], actor: { forms: ["上坂すみれ", "うえさかすみれ", "Uesaka Sumire"] } },
  { id: "maya-yamato", band: "pastel-palettes", forms: ["大和麻弥", "やまとまや", "Maya Yamato"], role: "Dr.", aliases: [], actor: { forms: ["中上育実", "なかがみいくみ", "Nakagami Ikumi"] } },
  { id: "eve-wakamiya", band: "pastel-palettes", forms: ["若宫伊芙", "若宮イヴ", "わかみやイヴ", "Eve Wakamiya"], role: "Key.", aliases: [], actor: { forms: ["秦佐和子", "はたさわこ", "Hata Sawako"] } },
  { id: "kokoro-tsurumaki", band: "hello-happy-world", forms: ["弦卷心", "弦巻こころ", "つるまきこころ", "Kokoro Tsurumaki"], role: "Vo.", aliases: [], actor: { forms: ["伊藤美来", "いとうみく", "Ito Miku"] } },
  { id: "kaoru-seta", band: "hello-happy-world", forms: ["濑田薰", "瀬田薫", "せたかおる", "Kaoru Seta"], role: "Gt.", aliases: [], actor: { forms: ["田所あずさ", "たどころあずさ", "Tadokoro Azusa"] } },
  { id: "hagumi-kitazawa", band: "hello-happy-world", forms: ["北泽育美", "北沢はぐみ", "きたざわはぐみ", "Hagumi Kitazawa"], role: "Ba.", aliases: [], actor: { forms: ["吉田有里", "よしだゆり", "Yoshida Yuri"] } },
  { id: "kanon-matsubara", band: "hello-happy-world", forms: ["松原花音", "まつばらかのん", "Kanon Matsubara"], role: "Dr.", aliases: [], actor: { forms: ["豊田萌絵", "とよだもえ", "Toyoda Moe"] } },
  { id: "misaki-okusawa", band: "hello-happy-world", forms: ["奥泽美咲", "奥沢美咲", "おくさわみさき", "Misaki Okusawa"], role: "DJ&Mp.", aliases: [["米歇尔", "ミッシェル", "みっしぇる", "Michelle"]], actor: { forms: ["黒沢ともよ", "くろさわともよ", "Kurosawa Tomoyo"] } },
  { id: "mashiro-kurata", band: "morfonica", forms: ["仓田真白", "倉田ましろ", "くらたましろ", "Mashiro Kurata"], role: "Vo.", aliases: [], actor: { forms: ["進藤あまね", "しんどうあまね", "Shindo Amane"] } },
  { id: "toko-kirigaya", band: "morfonica", forms: ["桐谷透子", "桐ヶ谷透子", "きりがやとうこ", "Toko Kirigaya"], role: "Gt.", aliases: [], actor: { forms: ["直田姫奈", "なおたひな", "Naota Hina"] } },
  { id: "nanami-hiromachi", band: "morfonica", forms: ["广町七深", "広町七深", "ひろまちななみ", "Nanami Hiromachi"], role: "Ba.", aliases: [], actor: { forms: ["西尾夕香", "にしおゆうか", "Nishio Yuka"] } },
  { id: "tsukushi-futaba", band: "morfonica", forms: ["二叶筑紫", "二葉つくし", "ふたばつくし", "Tsukushi Futaba"], role: "Dr.", aliases: [], actor: { forms: ["mika", "ミカ"] } },
  { id: "rui-yashio", band: "morfonica", forms: ["八潮瑠唯", "やしおるい", "Rui Yashio"], role: "Vn.", aliases: [], actor: { forms: ["Ayasa", "アヤサ"] } },
  { id: "rei-wakana", band: "raise-a-suilen", forms: ["LAYER", "レイヤ", "和奏レイ", "わかなレイ", "Rei Wakana"], role: "Ba./Vo.", aliases: [], actor: { forms: ["Raychell", "レイチェル"] } },
  { id: "rokka-asahi", band: "raise-a-suilen", forms: ["LOCK", "ロック", "朝日六花", "あさひろっか", "Rokka Asahi"], role: "Gt.", aliases: [], actor: { forms: ["小原莉子", "おはらりこ", "Ohara Riko"] } },
  { id: "masuki-sato", band: "raise-a-suilen", forms: ["MASKING", "マスキング", "佐藤ますき", "さとうますき", "Masuki Sato"], role: "Dr.", aliases: [], actor: { forms: ["夏芽", "なつめ", "Natsume"] } },
  { id: "reona-nyubara", band: "raise-a-suilen", forms: ["PAREO", "パレオ", "鳰原令王那", "におはられおな", "Reona Nyubara"], role: "Key.", aliases: [], actor: { forms: ["倉知玲鳳", "くらちれお", "Kurachi Reo"] } },
  { id: "chiyu-tamade", band: "raise-a-suilen", forms: ["CHU²", "チュチュ", "CHU2", "珠手ちゆ", "たまでちゆ", "Chiyu Tamade"], role: "DJ&Mp.", aliases: [], actor: { forms: ["紡木吏佐", "つむぎりさ", "Tsumugi Risa"] } },
  { id: "arale-nakamachi", band: "mugendai-mewtype", forms: ["仲町阿拉蕾", "仲町あられ", "なかまちあられ", "Arale Nakamachi"], role: "Vo.", aliases: [], actor: { forms: ["仲町阿拉蕾", "仲町あられ", "なかまちあられ", "Arale Nakamachi"], role: "Vo." } },
  { id: "nonoka-miyanaga", band: "mugendai-mewtype", forms: ["宫永野乃花", "宮永ののか", "みやながののか", "Nonoka Miyanaga"], role: "Gt.", aliases: [], actor: { forms: ["宫永野乃花", "宮永ののか", "みやながののか", "Nonoka Miyanaga"], role: "Gt." } },
  { id: "ritsu-minetsuki", band: "mugendai-mewtype", forms: ["峰月律", "みねつきりつ", "Ritsu Minetsuki"], role: "Gt.", aliases: [], actor: { forms: ["峰月律", "みねつきりつ", "Ritsu Minetsuki"], role: "Gt." } },
  { id: "miyako-fuji", band: "mugendai-mewtype", forms: ["藤都子", "ふじみやこ", "Miyako Fuji"], role: "Key.", aliases: [], actor: { forms: ["藤都子", "ふじみやこ", "Miyako Fuji"], role: "Key." } },
  { id: "yuno-sengoku", band: "mugendai-mewtype", forms: ["千石由乃", "千石ユノ", "せんごくユノ", "Yuno Sengoku"], role: "DJ&Mp.", aliases: [], actor: { forms: ["千石由乃", "千石ユノ", "せんごくユノ", "Yuno Sengoku"], role: "DJ&Mp." } },
  { id: "hotaru-shiomi", band: "millsage", forms: ["汐见萤", "汐見蛍", "しおみほたる", "Hotaru Shiomi"], role: "Key./Vo.", aliases: [], actor: { forms: ["結川あさき", "ゆいかわあさき", "Yuikawa Asaki"] } },
  { id: "natsume-izawa", band: "millsage", forms: ["伊泽枣", "伊沢なつめ", "いざわなつめ", "Natsume Izawa"], role: "Gt.", aliases: [], actor: { forms: ["伊駒ゆりえ", "いこまゆりえ", "Ikoma Yurie"] } },
  { id: "nagi-kotohira", band: "millsage", forms: ["琴平凪", "ことひらなぎ", "Nagi Kotohira"], role: "Gt.", aliases: [], actor: { forms: ["薬師寺李有", "やくしじりお", "Yakushiji Rio"] } },
  { id: "mahoro-hamasaki", band: "millsage", forms: ["滨崎茉幌", "浜崎まほろ", "はまさきまほろ", "Mahoro Hamasaki"], role: "Ba.", aliases: [], actor: { forms: ["咲川ひなの", "さきかわひなの", "Sakikawa Hinano"] } },
  { id: "houka-izumi", band: "millsage", forms: ["和泉朋花", "いずみほうか", "Houka Izumi"], role: "Dr.", aliases: [], actor: { forms: ["千春", "ちはる", "Chiharu"] } },
  { id: "raika-suga", band: "ikkadumbrock", forms: ["须贺蕾叶", "須賀蕾叶", "すがらいか", "Raika Suga"], role: "Gt./Vo.", aliases: [], actor: { forms: ["花宮初奈"] } },
  { id: "miku-mahashi", band: "ikkadumbrock", forms: ["马桥心玖", "馬橋心玖", "まばしみく", "Miku Mahashi"], role: "Gt./Vo.", aliases: [], actor: { forms: ["菱川花菜", "ひしかわはな", "Hishikawa Hana"] } },
  { id: "yomogi-yakura", band: "ikkadumbrock", forms: ["矢仓蓬咲", "矢倉蓬咲", "やくらよもぎ", "Yomogi Yakura"], role: "Ba.", aliases: [], actor: { forms: ["橘めい", "たちばなめい", "Tachibana Mei"] } },
  { id: "chieri-umezato", band: "ikkadumbrock", forms: ["梅里千樱梨", "梅里ちえり", "うめざとちえり", "Chieri Umezato"], role: "Dr.", aliases: [], actor: { forms: ["遠野ひかる", "とおのひかる", "Tono Hikaru"] } },
  { id: "shizuku-shinomiya", band: "ikkadumbrock", forms: ["四宫宁月", "四宮寧月", "しのみやしずく", "Shizuku Shinomiya"], role: "Key.", aliases: [], actor: { forms: ["涼泉桜花", "すずみおうか", "Suzumi Ouka"] } },
  { id: "karuta-otozu", band: "kuzumimizuku", forms: ["乙津歌留多", "Karuta Otozu"], role: "Ba.", aliases: [], actor: { forms: ["藍楠"] } },
  { id: "su-iitoyo", band: "kuzumimizuku", forms: ["飯豊澄羽", "Su Iitoyo"], role: "Gt.", aliases: [], actor: { forms: ["茉那"] } },
  { id: "wakaba-wakahori", band: "kuzumimizuku", forms: ["若堀若葉", "Wakaba Wakahori"], role: "Vo.", aliases: [], actor: { forms: ["和音"] } },
  { id: "fuka-utsugi", band: "kuzumimizuku", forms: ["卯木風薫", "Fuka Utsugi"], role: "Dr.", aliases: [], actor: { forms: ["乃逢"] } },
  { id: "shino-yatsumine", band: "kuzumimizuku", forms: ["八峰志乃", "Shino Yatsumine"], role: "Key.", aliases: [], actor: { forms: ["佳哉"] } },
  { id: "hina", band: "diamond-dust", forms: ["日菜", "ヒナ", "ひな", "HINA"], role: "Vo.", aliases: [], actor: { forms: ["近藤玲奈", "こんどうれいな", "Kondo Reina"] } },
  { id: "nana", band: "diamond-dust", forms: ["奈奈", "ナナ", "なな", "NANA"], aliases: [], actor: { forms: ["松岡美里", "まつおかみさと", "Matsuoka Misato"] } },
  { id: "rin", band: "diamond-dust", forms: ["凛", "リン", "りん", "RIN"], aliases: [], actor: { forms: ["漆山ゆうき", "うるしやまゆうき", "Urushiyama Yuki"] } },
  { id: "ai", band: "diamond-dust", forms: ["爱", "アイ", "あい", "AI"], aliases: [], actor: { forms: ["宮白桃子", "みやしろももこ", "Miyashiro Momoko"] } },
  { id: "shion-sakakibara", band: "canna-lily", forms: ["榊原紫苑", "さかきばらしおん", "SHION SAKAKIBARA"], role: "Ba.", aliases: [], actor: { forms: ["紫乃月姫咲"], role: "Ba." } },
  { id: "rindo-chigasaki", band: "canna-lily", forms: ["千ヶ崎竜胆", "ちがさきりんどう", "RINDO CHIGASAKI"], role: "Dr.", aliases: [], actor: { forms: ["椎名在音"], role: "Dr." } },
  { id: "ayame-hoshi", band: "canna-lily", forms: ["星亜矢芽", "ほしあやめ", "AYAME HOSHI"], role: "Gt.", aliases: [], actor: { forms: ["早坂莉宁", "早坂莉寧"], role: "Gt." } },
  { id: "kaede-kitsuta", band: "canna-lily", forms: ["橘田枫", "橘田楓", "きつたかえで", "KAEDE KITSUTA"], role: "Vo.", aliases: [], actor: { forms: ["箭野结羽", "箭野結羽"], role: "Vo." } },
  { id: "nazuna-yukishima", band: "canna-lily", forms: ["雪志摩ナズナ", "ゆきしまナズナ", "NAZUNA YUKISHIMA"], role: "Key.", aliases: [], actor: { forms: ["佐野樱", "佐野櫻"], role: "Key." } },
  { id: "ari-nakamura", band: "f-272", forms: ["中村有", "なかむらあり", "ARI NAKAMURA"], role: "Dr.", aliases: [], actor: { forms: ["YOSHI"], role: "Dr." } },
  { id: "koto-udagawa", band: "f-272", forms: ["宇田川琴", "うだがわこと", "KOTO UDAGAWA"], role: "Gt.", aliases: [], actor: { forms: ["TOWA"], role: "Gt." } },
  { id: "hazuki-kuromiya", band: "f-272", forms: ["黒宮八月", "くろみやはづき", "HAZUKI KUROMIYA"], role: "Gt.", aliases: [], actor: { forms: ["MIYU"], role: "Gt." } },
  { id: "momono-asai", band: "f-272", forms: ["浅井萌々乃", "あさいももの", "MOMONO ASAI"], role: "Ba.", aliases: [], actor: { forms: ["HINANO"], role: "Ba." } },
  { id: "saki-kato", band: "f-272", forms: ["加藤嗄生", "かとうさき", "SAKI KATO"], role: "Vo.", aliases: [], actor: { forms: ["LUCA"], role: "Vo." } },
];

const BY_ID = new Map(MEMBER_ENTITIES.map((m) => [m.id, m]));

/** 按 id 查角色：角色页、sitemap、OG 图都从这里进 */
export function memberById(id: string): MemberEntity | undefined {
  return BY_ID.get(id);
}
