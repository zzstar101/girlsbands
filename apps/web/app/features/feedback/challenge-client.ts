export interface ChallengeOptions {
  sitekey: string;
  action: string;
  'response-field': false;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
  'timeout-callback': () => void;
}
export interface ChallengeApi {
  render: (container: HTMLElement, options: ChallengeOptions) => string;
  remove: (id: string) => void;
}

/** The bits of the browser used to load the challenge script, narrow enough to fake in a test. */
export interface ChallengeScriptDocument {
  createElement: (tag: 'script') => HTMLScriptElement;
  head: { append: (script: HTMLScriptElement) => void };
}
export interface ChallengeScriptWindow {
  turnstile?: ChallengeApi;
}
export interface ChallengeLoaderOptions {
  document: ChallengeScriptDocument;
  window: ChallengeScriptWindow;
  src: string;
  timeoutMs?: number;
}

export const CHALLENGE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * One shared promise for the challenge script. A failed load (error or timeout) removes its script and
 * lets the next caller start a fresh one; a late event from an abandoned load can never settle the newer
 * promise. The browser keeps the loaded script, so a successful load is reused until the page goes away.
 */
export function createChallengeLoader({ document, window, src, timeoutMs = 15000 }: ChallengeLoaderOptions): () => Promise<ChallengeApi> {
  let pending: Promise<ChallengeApi> | null = null;
  return () => {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (pending) return pending;
    const attempt = new Promise<ChallengeApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.remove();
        reject(new Error(message));
      };
      const succeed = (api: ChallengeApi) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(api);
      };
      timer = setTimeout(() => fail('verification script timed out'), timeoutMs);
      script.onerror = () => fail('verification script unavailable');
      script.onload = () => {
        const api = window.turnstile;
        if (api) succeed(api);
        else fail('verification script unavailable');
      };
      try { document.head.append(script); } catch { fail('verification script unavailable'); }
    });
    let guarded: Promise<ChallengeApi>;
    guarded = attempt.catch(error => {
      if (pending === guarded) pending = null;
      throw error;
    });
    pending = guarded;
    return guarded;
  };
}

export function mountChallenge(api: ChallengeApi, container: HTMLElement, sitekey: string, onToken: (token: string) => void, onError: (message: string) => void): () => void {
  let active = true;
  const clear = () => { if (active) onToken(''); };
  clear();
  const fail = () => { if (active) { clear(); onError('人机验证未完成，请重试或通过联系邮箱反馈。'); } };
  const id = api.render(container, {
    sitekey, action: 'feedback', 'response-field': false,
    callback: token => { if (active) { onError(''); onToken(token); } },
    'expired-callback': clear, 'error-callback': fail, 'timeout-callback': fail,
  });
  return () => {
    if (!active) return;
    clear();
    active = false;
    api.remove(id);
  };
}
