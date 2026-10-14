import { describe, expect, it } from 'vitest';
import { getCatalogue, getCatalogueItem } from '@/mvp/config/buyers-config';
import { isSearchItemId, itemPhrases, registerSearchItemTerms, searchItemFromId, searchItemId, searchItemName, standardsIn } from './item';
import { resolveSearchItem } from './material-catalogue';

describe('search item identity (docs/mvp/22 §3.1)', () => {
  it('turns any typed product into a stable id that carries its words', () => {
    expect(searchItemId('API 660 Heat Exchangers')).toBe('q:api-660-heat-exchangers');
    expect(searchItemId('  Pressure   Vessel ')).toBe('q:pressure-vessel');
    expect(searchItemId('Séparateurs / two-phase')).toBe('q:separateurs-two-phase');
    expect(searchItemName('q:centrifugal-fans')).toBe('centrifugal fans');
    expect(isSearchItemId('q:axial-fans')).toBe(true);
    for (const bad of ['line-pipe', 'q:', 'q:a b', 'q:-x', 'q:<script>', `q:${'a'.repeat(90)}`]) expect(isSearchItemId(bad)).toBe(false);
  });
  it('builds an item shaped like a catalogue entry, without entering the catalogue', () => {
    const item = getCatalogueItem('q:api-660-heat-exchangers')!;
    expect(item).toMatchObject({ id: 'q:api-660-heat-exchangers', category: 'Searched item', shortName: 'api 660 heat exchangers', standards: ['API 660'] });
    expect(item.keywords).toEqual(expect.arrayContaining(['api 660 heat exchangers', 'api 660 heat exchanger', 'heat exchangers', 'heat exchanger']));
    expect(getCatalogue().items.some((i) => i.id.startsWith('q:'))).toBe(false);
  });
  it('knows singular and plural forms and standards', () => {
    expect(itemPhrases('centrifugal fans')).toEqual(['centrifugal fans', 'centrifugal fan']);
    expect(itemPhrases('Blower')).toEqual(['blower', 'blowers']);
    expect(itemPhrases('supply of pressure vessels')).toEqual(['pressure vessels', 'pressure vessel']);
    expect(standardsIn('ASME Sec VIII Div 1 pressure vessel to API 660')).toEqual(['ASME SEC VIII DIV 1', 'API 660']);
  });
  it('adds the brief\'s other names for that item only', () => {
    registerSearchItemTerms('q:heat-exchanger-test', ['Shell and tube heat exchanger', 'x']);
    expect(searchItemFromId('q:heat-exchanger-test').keywords).toEqual(expect.arrayContaining(['shell and tube heat exchanger', 'shell and tube heat exchangers']));
    expect(searchItemFromId('q:other-item').keywords).not.toContain('shell and tube heat exchanger');
  });
});

describe('resolveSearchItem: a catalogue product only when the words are that product', () => {
  it.each([
    ['pressure vessel', 'q:pressure-vessel'],
    ['Pressure Vessels', 'q:pressure-vessels'],
    ['separators', 'q:separators'],
    ['centrifugal fans', 'q:centrifugal-fans'],
    ['axial fans', 'q:axial-fans'],
    ['blowers', 'q:blowers'],
    ['API 660 heat exchanger', 'q:api-660-heat-exchanger'],
    ['ball valve actuator', 'q:ball-valve-actuator'],
    ['valves', 'q:valves'],
  ])('%s is searched as typed', (query, id) => {
    expect(resolveSearchItem(query)).toEqual({ productId: id, catalogue: false });
  });
  it.each([
    ['stainless steel pipe 316L', 'ss-duplex-pipe'],
    ['ASTM A312 TP316L seamless pipe', 'ss-duplex-pipe'],
    ['seamless pipe A106', 'cs-process-pipe'],
    ['line pipe API 5L X65', 'line-pipe'],
    ['ductile iron pipe', 'di-pipe'],
    ['stud bolts', 'stud-bolts'],
  ])('%s keeps its catalogue knowledge', (query, id) => {
    expect(resolveSearchItem(query)).toEqual({ productId: id, catalogue: true });
  });
});
