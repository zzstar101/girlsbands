import { describe, expect, test } from 'bun:test';
import {
  createChallengeLoader,
  type ChallengeApi,
  type ChallengeScriptDocument,
  type ChallengeScriptWindow,
} from '../app/features/feedback/challenge-client';

interface FakeScript {
  src: string;
  async: boolean;
  onload: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  removed: boolean;
  remove: () => void;
}

function fixture(timeoutMs = 100) {
  const scripts: FakeScript[] = [];
  const window: ChallengeScriptWindow = {};
  const document: ChallengeScriptDocument = {
    createElement: () => {
      const script: FakeScript = {
        src: '', async: false, onload: null, onerror: null, removed: false,
        remove() { script.removed = true; },
      };
      scripts.push(script);
      return script as unknown as HTMLScriptElement;
    },
    head: { append: () => {} },
  };
  return { load: createChallengeLoader({ document, window, src: 'https://challenges.test/api.js', timeoutMs }), scripts, window };
}

const api: ChallengeApi = { render: () => 'widget', remove: () => {} };

describe('shared challenge script loader', () => {
  test('concurrent callers share one script and one resolved API', async () => {
    const { load, scripts, window } = fixture();
    const first = load();
    const second = load();
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toBe('https://challenges.test/api.js');
    expect(scripts[0]!.async).toBe(true);
    window.turnstile = api;
    scripts[0]!.onload!(new Event('load'));
    expect(await first).toBe(api);
    expect(await second).toBe(api);
    expect(await load()).toBe(api);
    expect(scripts).toHaveLength(1);
  });

  test('a failed load removes its script and a retry starts a fresh one', async () => {
    const { load, scripts, window } = fixture();
    const first = load();
    scripts[0]!.onerror!(new Event('error'));
    await expect(first).rejects.toThrow('verification script unavailable');
    expect(scripts[0]!.removed).toBe(true);

    const retry = load();
    expect(scripts).toHaveLength(2);
    window.turnstile = api;
    scripts[1]!.onload!(new Event('load'));
    expect(await retry).toBe(api);
  });

  test('a timeout rejects, and a late load from the abandoned script cannot settle the retry', async () => {
    const { load, scripts, window } = fixture(10);
    const abandoned = load();
    await expect(abandoned).rejects.toThrow('verification script timed out');
    expect(scripts[0]!.removed).toBe(true);

    const retry = load();
    expect(scripts).toHaveLength(2);
    let settled = false;
    void retry.then(() => { settled = true; });
    window.turnstile = api;
    scripts[0]!.onload!(new Event('load'));
    await Promise.resolve();
    expect(settled).toBe(false);
    scripts[1]!.onload!(new Event('load'));
    expect(await retry).toBe(api);
  });

  test('a script that loads without defining turnstile fails closed and can be retried', async () => {
    const { load, scripts } = fixture();
    const first = load();
    scripts[0]!.onload!(new Event('load'));
    await expect(first).rejects.toThrow('verification script unavailable');
    expect(scripts[0]!.removed).toBe(true);
    expect(scripts).toHaveLength(1);
    const retry = load();
    expect(scripts).toHaveLength(2);
    scripts[1]!.onerror!(new Event("error"));
    await expect(retry).rejects.toThrow("verification script unavailable");
  });
});
