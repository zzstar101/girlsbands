import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { SITE } from '@girlsbands/industry/site';
import { CHALLENGE_SCRIPT, createChallengeLoader, mountChallenge, type ChallengeApi } from './challenge-client';

declare global { interface Window { turnstile?: ChallengeApi } }

let loader: (() => Promise<ChallengeApi>) | null = null;
function loadChallenge(): Promise<ChallengeApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('verification needs a browser'));
  // Created lazily: the module is imported during SSR too, where there is no document to append to.
  loader ??= createChallengeLoader({ document, window, src: CHALLENGE_SCRIPT });
  return loader();
}

/**
 * The sheet keeps its last children mounted while it animates out, so a challenge inside it cannot rely
 * on unmounting to learn that the form closed. This context is read through that retained subtree: when
 * `active` turns false the widget is removed at once and any late callback from it is ignored.
 */
const ActiveContext = createContext(true);

export function FeedbackChallengeScope({ active, children }: { active: boolean; children: ReactNode }) {
  return <ActiveContext.Provider value={active}>{children}</ActiveContext.Provider>;
}

export function useFeedbackChallenge() {
  const [token, setToken] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => { setToken(''); setResetKey(n => n + 1); }, []);
  return { token, setToken, resetKey, reset };
}

/** Only mount while a feedback form is visible. Tokens never enter drafts or local storage. */
export function FeedbackChallenge({ onToken, resetKey }: { onToken: (token: string) => void; resetKey: number }) {
  const container = useRef<HTMLDivElement>(null);
  const active = useContext(ActiveContext);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    onToken(''); setError(''); setBusy(true);
    void (async () => {
      try {
        const response = await fetch('/api/site/feedback/config', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('configuration unavailable');
        const config: unknown = await response.json();
        const siteKey = config && typeof config === 'object' && 'siteKey' in config ? config.siteKey : null;
        if (typeof siteKey !== 'string' || !siteKey) throw new Error('verification not configured');
        // Do not even fetch the third-party script for a form that closed while the config was in flight.
        if (controller.signal.aborted) return;
        const api = await loadChallenge();
        // The form may have closed, or been submitted, while the configuration and script loaded.
        if (controller.signal.aborted || !container.current) return;
        dispose = mountChallenge(api, container.current, siteKey, onToken, setError);
        setBusy(false);
      } catch {
        if (!controller.signal.aborted) { setBusy(false); setError('人机验证暂时不可用，填写的内容不会被清空。可以重试或通过联系邮箱反馈。'); }
      }
    })();
    return () => { controller.abort(); dispose?.(); };
  }, [active, onToken, resetKey, retry]);
  return (
    <div className="space-y-2 text-[12px] leading-relaxed text-ink-3">
      {active && <p>匿名提交，无需登录。请完成人机验证。</p>}
      {/* Kept mounted while inactive: the sheet keeps this subtree during its exit animation, and the
          widget must still have its container when remove() runs on close. */}
      <div ref={container} />
      {active && busy && <p role="status">正在加载人机验证…</p>}
      {active && error && <div role="alert">
        <p>{error}</p>
        <button type="button" className="mr-3 text-accent underline" onClick={() => setRetry(n => n + 1)}>重新验证</button>
        <a className="text-accent underline" href={`mailto:${SITE.contactEmail}`}>联系邮箱</a>
      </div>}
      {active && <noscript>提交需要启用 JavaScript 完成人机验证，也可以通过联系邮箱反馈。</noscript>}
    </div>
  );
}
