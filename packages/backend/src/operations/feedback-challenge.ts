import { config, credential } from '../config.ts';
import { Rejected } from './abuse.ts';

/** Public key only; partial configuration must not invite an unprotected submission. */
export function feedbackChallengeConfig(): { siteKey: string | null } {
  const siteKey = credential('auth', 'TURNSTILE_SITE_KEY');
  return { siteKey: siteKey && credential('auth', 'TURNSTILE_SECRET_KEY') ? siteKey : null };
}

/** Tokens are single-use and expire at the provider; no local success cache or fail-open path. */
export async function verifyFeedbackChallenge(token: string | null, ip: string): Promise<void> {
  const secret = credential('auth', 'TURNSTILE_SECRET_KEY');
  if (!secret || !feedbackChallengeConfig().siteKey) {
    throw new Rejected(503, 'temporarily_unavailable', '反馈验证暂未配置，请通过联系邮箱反馈。', 60);
  }
  if (!token || token.length > 2048) throw new Rejected(400, 'invalid_request', '请先完成人机验证。');
  let result: unknown;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) throw new Error('verification service unavailable');
    result = await response.json();
  } catch {
    throw new Rejected(503, 'temporarily_unavailable', '人机验证服务暂时不可用，请稍后重试或通过联系邮箱反馈。', 30);
  }
  if (!result || typeof result !== 'object') throw new Rejected(503, 'temporarily_unavailable', '人机验证服务返回异常，请稍后重试。', 30);
  const data = result as Record<string, unknown>;
  if (data.success !== true || data.hostname !== new URL(config.siteUrl).hostname || data.action !== 'feedback') {
    throw new Rejected(400, 'invalid_request', '人机验证未通过或已过期，请重新验证后提交。');
  }
}
