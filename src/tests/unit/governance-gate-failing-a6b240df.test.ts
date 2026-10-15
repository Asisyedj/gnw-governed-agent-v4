import { describe, expect, it } from 'vitest';

describe('temporary governance failed-check test', () => {
  it('intentionally fails Build & Test for the merge-policy drill', () => {
    expect('deliberate-failure').toBe('pass');
  });
});
