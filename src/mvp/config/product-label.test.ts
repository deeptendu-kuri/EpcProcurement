// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { searchedProductLabel } from './product-label';
describe('searched product wording',()=>{
  it('preserves the exact supported material instead of a generic catalogue short name',()=>{
    expect(searchedProductLabel('cables','Power and control cables','cables')).toBe('Power and control cables');
    expect(searchedProductLabel('cs-process-pipe','Carbon steel pipe','CS pipe')).toBe('Carbon steel pipe');
  });
  it('does not turn arbitrary queries or conflicting product names into claimed products',()=>{
    expect(searchedProductLabel('cables','oil and gas pipeline projects','cables')).toBe('cables');
    expect(searchedProductLabel('cables','HDPE pipe','cables')).toBe('cables');
  });
});
