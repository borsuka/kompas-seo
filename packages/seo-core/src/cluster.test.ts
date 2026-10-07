import { describe, expect, it } from 'vitest';
import { clusterKeywords, cosineSimilarity, type ClusterInput } from './cluster.js';

const urls = (prefix: string, ids: number[]) => ids.map((i) => `https://www.${prefix}${i}.bg/page`);

describe('clusterKeywords', () => {
  it('groups keywords sharing ≥ 3 top-10 URLs, transitively, named by top volume', () => {
    const input: ClusterInput[] = [
      { keyword: 'seo оптимизация', volume: 1000, topUrls: urls('a', [1, 2, 3, 4, 5]) },
      { keyword: 'seo оптимизация цена', volume: 300, topUrls: urls('a', [1, 2, 3, 9, 10]) },
      // shares 3 with the previous one only (transitive link)
      { keyword: 'seo услуги цена', volume: 400, topUrls: urls('a', [9, 10, 1, 20, 21]) },
      { keyword: 'обувки', volume: 5000, topUrls: urls('b', [1, 2, 3, 4]) },
      { keyword: 'маратонки', volume: 800, topUrls: urls('b', [1, 2, 7, 8]) },
    ];
    const clusters = clusterKeywords(input);
    const byName = Object.fromEntries(clusters.map((c) => [c.name, c]));
    expect(byName['seo оптимизация']!.keywords).toEqual([
      'seo оптимизация',
      'seo услуги цена',
      'seo оптимизация цена',
    ]);
    expect(byName['seo оптимизация']!.method).toBe('serp');
    expect(byName['обувки']!.keywords).toEqual(['обувки']);
    expect(byName['маратонки']!.keywords).toEqual(['маратонки']);
    expect(clusters[0]!.name).toBe('обувки');
  });

  it('respects a configurable threshold and normalizes URLs', () => {
    const input: ClusterInput[] = [
      { keyword: 'a', volume: 1, topUrls: ['https://x.bg/1', 'https://x.bg/2'] },
      { keyword: 'b', volume: 2, topUrls: ['http://www.x.bg/1/', 'https://x.bg/2?utm=1'] },
    ];
    expect(clusterKeywords(input)).toHaveLength(2);
    expect(clusterKeywords(input, { minSharedUrls: 2 })).toHaveLength(1);
  });

  it('falls back to embeddings, then to token overlap, for keywords without SERP data', () => {
    const input: ClusterInput[] = [
      { keyword: 'червено вино', volume: 100, topUrls: urls('w', [1, 2, 3]), embedding: [1, 0, 0] },
      { keyword: 'вино червено сухо', volume: 10, embedding: [0.95, 0.1, 0] },
      { keyword: 'бира', volume: 50, embedding: [0, 1, 0] },
      { keyword: 'зимни гуми', volume: 70, topUrls: urls('g', [1, 2, 3]) },
      { keyword: 'зимни гуми цена', volume: 30 },
    ];
    const clusters = clusterKeywords(input);
    const find = (k: string) => clusters.find((c) => c.keywords.includes(k))!;
    expect(find('вино червено сухо').name).toBe('червено вино');
    expect(find('вино червено сухо').method).toBe('embedding');
    expect(find('бира').keywords).toEqual(['бира']);
    expect(find('зимни гуми цена').name).toBe('зимни гуми');
    expect(find('зимни гуми цена').method).toBe('lexical');
  });

  it('clusters 500 keywords quickly and reports progress', () => {
    const input: ClusterInput[] = Array.from({ length: 500 }, (_, i) => ({
      keyword: `kw ${i}`,
      volume: i,
      topUrls: urls(`t${i % 50}-`, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    }));
    const progress: number[] = [];
    const started = performance.now();
    const clusters = clusterKeywords(input, { onProgress: (p) => progress.push(p) });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(clusters).toHaveLength(50);
    expect(clusters.every((c) => c.keywords.length === 10)).toBe(true);
    expect(progress.at(-1)).toBe(1);
  });

  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
