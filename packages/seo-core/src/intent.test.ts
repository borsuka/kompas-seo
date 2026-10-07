import { describe, expect, it } from 'vitest';
import { classifyIntent } from './intent.js';

describe('classifyIntent', () => {
  it.each([
    ['купи маратонки', 'transactional'],
    ['евтини полети до лондон', 'transactional'],
    ['цена на seo оптимизация', 'transactional'],
    ['buy running shoes', 'transactional'],
    ['какво е seo', 'informational'],
    ['как да отслабна', 'informational'],
    ['how to bake bread', 'informational'],
    ['iphone 17 vs samsung s26', 'commercial'],
    ['най-добрите лаптопи 2026', 'commercial'],
    ['отзиви за хотел морско око', 'commercial'],
    ['best crm software', 'commercial'],
    ['emag.bg', 'navigational'],
    ['facebook login', 'navigational'],
  ])('%s → %s', (keyword, expected) => {
    const r = classifyIntent(keyword);
    expect(r.intents[0]).toBe(expected);
    expect(r.needsLlm).toBe(false);
  });

  it('can return several intents', () => {
    const r = classifyIntent('най-добрите маратонки цена');
    expect(r.intents).toEqual(expect.arrayContaining(['transactional', 'commercial']));
  });

  it('uses SERP signals', () => {
    expect(classifyIntent('маратонки', ['shopping']).intents[0]).toBe('transactional');
    expect(classifyIntent('фотосинтеза', ['people_also_ask', 'featured_snippet']).intents[0]).toBe(
      'informational',
    );
  });

  it('flags keywords without rule matches for the LLM', () => {
    const r = classifyIntent('фотосинтеза');
    expect(r.needsLlm).toBe(true);
    expect(r.confidence).toBe(0);
  });

  it('does not match substrings of unrelated words', () => {
    // "как" must not match inside "какао" as a word rule
    expect(classifyIntent('какао на прах').scores.informational).toBe(0);
  });
});
