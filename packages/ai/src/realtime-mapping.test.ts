import { describe, it, expect } from 'vitest';
import { RealtimeSegmentMap } from './realtime-mapping.js';
describe('realtime identity mapping', () => {
  it('retains early delta mapping before application commit and late completion afterward', () => {
    const map = new RealtimeSegmentMap();
    map.begin('first');
    expect(map.resolve('item-1')).toBe('first');
    map.commit('first');
    map.begin('second');
    map.commit('second');
    expect(map.resolve('item-2')).toBe('second');
    expect(map.resolve('item-1')).toBe('first');
    expect(map.resolve('item-2')).toBe('second');
  });
  it('maps provider committed identities in commit order then completes out of order', () => {
    const map = new RealtimeSegmentMap();
    map.begin('first');
    map.commit('first');
    map.begin('second');
    map.commit('second');
    expect(map.resolve('item-1')).toBe('first');
    expect(map.resolve('item-2')).toBe('second');
    expect(map.resolve('item-2')).toBe('second');
    expect(map.resolve('item-1')).toBe('first');
  });
  it('does not attach unsolicited provider items to a prior segment', () => {
    const map = new RealtimeSegmentMap();
    expect(() => map.resolve('no-input')).toThrow('UNMAPPED');
    map.begin('first');
    map.resolve('item-1');
    expect(() => map.resolve('extra')).toThrow('UNMAPPED');
  });
});
