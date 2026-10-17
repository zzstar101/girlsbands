import { describe, expect, test } from 'bun:test';
import { mountChallenge, type ChallengeOptions, type ChallengeApi } from '../app/features/feedback/challenge-client';

describe('feedback widget lifecycle', () => {
  function fixture() {
    let options!: ChallengeOptions;
    const removed: string[] = [];
    const tokens: string[] = [];
    const errors: string[] = [];
    const api: ChallengeApi = { render: (_element, opts) => { options = opts; return 'widget-1'; }, remove: id => { removed.push(id); } };
    const dispose = mountChallenge(api, {} as HTMLElement, 'public-key', token => tokens.push(token), message => errors.push(message));
    return { options, removed, tokens, errors, dispose };
  }
  test('binds feedback action and never submits a hidden stale token', () => {
    const x = fixture();
    expect(x.options.action).toBe('feedback');
    expect(x.options['response-field']).toBe(false);
    x.options.callback('verified-token');
    expect(x.tokens.at(-1)).toBe('verified-token');
    x.options['expired-callback']();
    expect(x.tokens.at(-1)).toBe('');
  });
  test('failure and interactive timeout clear the token', () => {
    const x = fixture();
    x.options.callback('verified-token');
    x.options['error-callback']();
    expect(x.tokens.at(-1)).toBe('');
    expect(x.errors.length).toBeGreaterThan(0);
    x.options.callback('another-token');
    x.options['timeout-callback']();
    expect(x.tokens.at(-1)).toBe('');
  });
  test('unmount removes the widget and ignores late success callbacks', () => {
    const x = fixture();
    x.dispose();
    expect(x.removed).toEqual(['widget-1']);
    expect(x.tokens.at(-1)).toBe('');
    x.options.callback('late-token');
    expect(x.tokens.at(-1)).toBe('');
    x.options['error-callback']();
    x.options['timeout-callback']();
    expect(x.errors).toEqual([]);
  });
  test('mounting clears a token left by an earlier widget before rendering the new one', () => {
    const tokens: string[] = [];
    const removed: string[] = [];
    const api: ChallengeApi = { render: () => 'widget-2', remove: id => { removed.push(id); } };
    mountChallenge(api, {} as HTMLElement, 'public-key', token => tokens.push(token), () => {});
    expect(tokens).toEqual(['']);
    expect(removed).toEqual([]);
  });
  test('dispose is idempotent and never removes a widget twice', () => {
    const x = fixture();
    x.dispose();
    x.dispose();
    expect(x.removed).toEqual(['widget-1']);
  });
});
