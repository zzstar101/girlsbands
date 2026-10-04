-- 国内活动排期平台单独一档：industry/selection.ts 的 T2_EVENT，门槛 54。
--
-- 无差别同人站、B 站会员购、秀动的一条记录就是一场活动（日期、城市、会场、开票、票价），没有正文。
-- 在“媒体与个人”那一档（T2 = 72）下，标注为“该选”的国内活动一条都进不了精选；15 条标注样本上
-- T2_EVENT = 54 能选上 13 条、零误选。把 T2 整体降到 54 也会连日语媒体源一起降，所以另开一档
-- （完整依据见 docs/selection.md 的第二版校准与 industry/selection.ts 的注释）。
--
-- 档位白名单一共三处，必须同时改：这里的 CHECK 约束、packages/backend/src/admin/sources.ts 的
-- z.enum（EDITABLE 与新建两处）、apps/web/app/features/admin/labels.ts 的 TIER_LABEL。
--
-- 与 0055/0056 同理：scripts/seed.ts 只插不更新（ON CONFLICT (id) DO NOTHING），已经装好的实例
-- 必须靠迁移把这三个源的档位改过来；全新安装直接读 industry/sources.json。
ALTER TABLE sources DROP CONSTRAINT sources_tier_check;
ALTER TABLE sources ADD CONSTRAINT sources_tier_check
  CHECK (tier = ANY (ARRAY['T1', 'T1_5', 'T2', 'T2_EVENT', 'EXCLUDE_MP']));

UPDATE sources SET tier = 'T2_EVENT'
WHERE id IN ('json-cpp-only-events', 'json-bilibili-show', 'web-showstart-events');
