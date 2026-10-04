// 邮件风格的登记处。每个风格一个文件、只导出一个 EmailStyle；这里是唯一知道全部风格的地方。
// 换风格：改 .env 里的 EMAIL_STYLE（或者 DEFAULT_EMAIL_STYLE），不用动发送层。
//
// 前 17 套纯文字排版（letter/poster/terminal、dispatch/brief/almanac/zine、flare/board/tally/stub、
// flyer/setlist/jacket/chiban、时间轴/票根/看板）全部被否，理由三次都指向同一件事：
// 纯文字排版再怎么调也炸裂不起来，而且越排越像网页——彩色的方块、栅格、卡片，本质还是网页。
// 所以这一版换了分工：**图负责炸裂，文字只负责说清楚**。每封有三件装置，都是 API 用 satori 现画：
//   1. 通栏头图 1200×450（邮件里 600×225）：官方 logo + 应援色底 + 巨号鬼影日号，见 apps/api/src/og/hero.ts；
//   2. 大标题牌 1104×218（显示 552×109）：Dela Gothic One 日文大标题 + 中文小注，见 apps/api/src/og/title.ts；
//   3. 日期牌 128×160（显示 64×80）：截止提醒里每天一张，同一台机器现画。
// 为什么标题要画成图：**邮件正文不能加载外部字体**（用户批注），Dela 在 Gmail、Outlook、iOS 邮件里
// 会变成三种样子。正文因此只剩 14/16/18/22 四级字号，把「什么时候、什么事、去哪看」说清楚；
// 主角乐队、日期、标题牌种类由 packages/backend/src/subscriptions/content.ts 按每一封算出来。
//   cover 封面 —— 三张图 + 最短正文：没有卡片、没有圆角、没有背景块、没有第二个色块
// 所有尺寸只能从 ../layout.ts 的标尺取，tests/email-templates.test.ts 会逐条核对。
import type { EmailStyle } from "./types.ts";
import cover from "./styles/cover.ts";

export const EMAIL_STYLES: Record<string, EmailStyle> = { cover };

export const DEFAULT_EMAIL_STYLE = "cover";

/** 按 id 取风格；id 不认识就退回默认（配置写错不该让定时任务整个停摆）。 */
export function emailStyle(id: string | null | undefined): EmailStyle {
  return (id && EMAIL_STYLES[id]) || EMAIL_STYLES[DEFAULT_EMAIL_STYLE]!;
}
