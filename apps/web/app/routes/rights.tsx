import { SITE } from "@girlsbands/industry/site";
import copy from "@girlsbands/industry/pages/rights.md?raw";
import { edgeTtl } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { prepareCopy } from "../lib/site-copy";
import { CopyPage, LegalFooterLinks } from "../features/copy/CopyPage";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me" };

const RIGHTS = prepareCopy(copy);

export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({ title: "权利与删除", description: "来源方怎么要求删除、更正或调整展示方式，以及我们会怎么处理。", path: "/rights", image: "/og/pages/rights.png" });
}

export default function RightsPage() {
  return (
    <CopyPage
      doc={RIGHTS.doc}
      rendered={RIGHTS.rendered}
      eyebrow={SITE.name}
      footer={<LegalFooterLinks links={[{ to: "/terms", label: "使用规则" }, { to: "/privacy", label: "隐私说明" }, { to: "/feedback", label: "反馈页" }]} note={`权利与删除 ${RIGHTS.doc.meta["版本"] ?? ""} · ${RIGHTS.doc.meta["生效日期"] ?? ""}`} />}
    />
  );
}
