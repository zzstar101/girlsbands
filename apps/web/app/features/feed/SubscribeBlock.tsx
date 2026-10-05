import { Link } from "react-router";

/** The mail block under the aside: the only place the home page asks the reader to sign up. */
export function SubscribeBlock() {
  return <section className="sub"><span className="big" aria-hidden="true">MAIL</span><h3>截止提醒邮件</h3><p>抽选和发售截止前 48 小时提醒，只包含你选择的乐队。也可以订阅每日精选。</p><div className="row relative"><Link to="/subscribe">订阅</Link><a href="/calendar.ics">日历订阅</a></div></section>;
}
