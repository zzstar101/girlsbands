// 「角色」名录的静态展开：主题页的角色段与 /members 目录都靠它把 industry 的两份表摊成页面上的分组。
import assert from "node:assert/strict";
import { test } from "node:test";
import { memberPath, membersOfSubject } from "../app/features/topic/member.ts";

test("membersOfSubject: 乐队就是它自己，成员按 MEMBER_ENTITIES 顺序", () => {
  const bands = membersOfSubject("togenashi-togeari");
  assert.equal(bands.length, 1);
  const band = bands[0]!;
  assert.equal(band.id, "togenashi-togeari");
  assert.equal(band.name, "トゲナシトゲアリ");
  assert.equal(band.accent, "#ff2d3f");
  assert.deepEqual(band.members, [
    { id: "nina-iseri", name: "井芹仁菜", role: null, actor: "理名" },
    { id: "momoka-kawaragi", name: "河原木桃香", role: null, actor: "夕莉" },
    { id: "subaru-awa", name: "安和昴", role: null, actor: "美怜" },
    { id: "tomo-ebizuka", name: "海老塚智", role: null, actor: "凪都" },
    { id: "rupa", name: "卢帕", role: null, actor: "朱李" },
  ]);
});

test("membersOfSubject: 担当只有官方写明的才带出来", () => {
  const f272 = membersOfSubject("f-272")[0]!;
  assert.deepEqual(f272.members.map((m) => m.role), ["Dr.", "Gt.", "Gt.", "Ba.", "Vo."]);
  assert.equal(f272.members[0]!.actor, "YOSHI");
  // VTuber 乐队角色名与本人同名，两个字段就是同一个写法
  const mewtype = membersOfSubject("mugendai-mewtype")[0]!;
  assert.equal(mewtype.members[0]!.name, "仲町阿拉蕾");
  assert.equal(mewtype.members[0]!.actor, "仲町阿拉蕾");
});

test("membersOfSubject: 企划展开系列里有成员的乐队，跳过企划自己", () => {
  const bands = membersOfSubject("bang-dream");
  assert.deepEqual(bands.map((b) => b.id), [
    "poppinparty", "afterglow", "roselia", "pastel-palettes", "hello-happy-world", "morfonica",
    "raise-a-suilen", "mygo", "ave-mujica", "mugendai-mewtype", "millsage", "ikkadumbrock",
  ]);
  // 企划自己没有成员，our-notes 这类没有角色的项目也不出现
  assert.ok(!bands.some((b) => b.id === "bang-dream" || b.id === "our-notes"));
  assert.ok(bands.every((b) => b.members.length > 0 && b.accent));
  assert.deepEqual(membersOfSubject("girls-band-cry").map((b) => b.id), ["togenashi-togeari", "canna-lily", "f-272", "kuzumimizuku", "diamond-dust"]);
});

test("membersOfSubject: 方向页与不认识的 id 没有角色", () => {
  assert.deepEqual(membersOfSubject("live"), []);
  assert.deepEqual(membersOfSubject("no-such-subject"), []);
});

test("memberPath", () => {
  assert.equal(memberPath("nina-iseri"), "/member/nina-iseri");
});
