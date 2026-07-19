import { describe, it, expect } from 'vitest';
import { initialState, IllegalMove, opponent } from './gameState';

describe('initialState', () => {
  it('has the requested size', () => {
    expect(initialState(9).size).toBe(9);
    expect(initialState(13).size).toBe(13);
  });

  it('starts with no pieces', () => {
    expect(initialState(9).pieces).toEqual({});
  });

  it("starts with white to move", () => {
    expect(initialState(9).turn).toBe('white');
  });

  it('starts with zero captures for both players', () => {
    expect(initialState(9).captures).toEqual({ white: 0, black: 0 });
  });

  it('starts with no winner', () => {
    expect(initialState(9).winner).toBeNull();
  });

  it('starts with no winning line', () => {
    expect(initialState(9).winningLine).toBeUndefined();
  });

  it('exports IllegalMove as an Error subclass', () => {
    expect(new IllegalMove('x')).toBeInstanceOf(Error);
  });

  it('names IllegalMove and preserves its message', () => {
    // The `name` is load-bearing: error handling / logs discriminate on it.
    const e = new IllegalMove('bad move');
    expect(e.name).toBe('IllegalMove');
    expect(e.message).toBe('bad move');
  });
});

describe('opponent', () => {
  it('maps each colour to the other, both directions', () => {
    expect(opponent('white')).toBe('black');
    expect(opponent('black')).toBe('white');
  });
});
