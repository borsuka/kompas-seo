/**
 * Keyword clustering by SERP overlap: two keywords belong together when their top-10
 * results share at least `minSharedUrls` URLs (default 3). Clusters are the connected
 * components of that graph (union–find). Keywords without SERP data fall back to
 * embedding cosine similarity (or token overlap when no embeddings are available).
 */

export interface ClusterInput {
  keyword: string;
  volume: number;
  /** Top-10 organic URLs; empty/undefined when SERP data is missing. */
  topUrls?: readonly string[];
  embedding?: readonly number[];
}

export interface ClusterOptions {
  minSharedUrls?: number;
  /** Cosine similarity needed to attach a keyword without SERP data. */
  minSimilarity?: number;
  /** Token Jaccard similarity used when neither SERP nor embeddings exist. */
  minTokenSimilarity?: number;
  onProgress?: (fraction: number) => void;
}

export interface Cluster {
  /** Highest-volume keyword of the cluster. */
  name: string;
  keywords: string[];
  totalVolume: number;
  /** How members were grouped. */
  method: 'serp' | 'embedding' | 'lexical' | 'single';
}

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array<number>(n).fill(0);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra]! < this.rank[rb]!) this.parent[ra] = rb;
    else if (this.rank[ra]! > this.rank[rb]!) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra]!++;
    }
  }
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

function normalizeUrl(url: string): string {
  return url
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function clusterKeywords(
  input: readonly ClusterInput[],
  opts: ClusterOptions = {},
): Cluster[] {
  const minShared = opts.minSharedUrls ?? 3;
  const minSim = opts.minSimilarity ?? 0.8;
  const minTokenSim = opts.minTokenSimilarity ?? 0.5;
  const n = input.length;
  const uf = new UnionFind(n);
  const method: Cluster['method'][] = new Array(n).fill('single');

  // 1) SERP overlap via an inverted index URL → keyword indices: O(Σ urls × postings).
  const withSerp: number[] = [];
  const index = new Map<string, number[]>();
  input.forEach((kw, i) => {
    const urls = [...new Set((kw.topUrls ?? []).slice(0, 10).map(normalizeUrl))];
    if (!urls.length) return;
    withSerp.push(i);
    for (const u of urls) {
      const list = index.get(u);
      if (list) list.push(i);
      else index.set(u, [i]);
    }
  });

  const shared = new Map<number, Map<number, number>>();
  for (const postings of index.values()) {
    for (let x = 0; x < postings.length; x++) {
      for (let y = x + 1; y < postings.length; y++) {
        const a = postings[x]!;
        const b = postings[y]!;
        let row = shared.get(a);
        if (!row) shared.set(a, (row = new Map()));
        row.set(b, (row.get(b) ?? 0) + 1);
      }
    }
  }
  let done = 0;
  for (const [a, row] of shared) {
    for (const [b, count] of row) {
      if (count >= minShared) {
        uf.union(a, b);
        method[a] = method[b] = 'serp';
      }
    }
    if (++done % 50 === 0) opts.onProgress?.(0.8 * (done / Math.max(1, shared.size)));
  }

  // 2) Fallback for keywords without SERP: attach to the most similar keyword.
  const serpSet = new Set(withSerp);
  for (let i = 0; i < n; i++) {
    if (serpSet.has(i)) continue;
    const kw = input[i]!;
    let best = -1;
    let bestScore = 0;
    let via: Cluster['method'] = 'single';
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const other = input[j]!;
      const useEmbedding = !!(kw.embedding && other.embedding);
      const score = useEmbedding
        ? cosineSimilarity(kw.embedding!, other.embedding!)
        : tokenSimilarity(kw.keyword, other.keyword);
      const m: Cluster['method'] = useEmbedding
        ? score >= minSim
          ? 'embedding'
          : 'single'
        : score >= minTokenSim
          ? 'lexical'
          : 'single';
      if (m !== 'single' && score > bestScore) {
        best = j;
        bestScore = score;
        via = m;
      }
    }
    if (best >= 0) {
      uf.union(i, best);
      method[i] = via;
    }
  }
  opts.onProgress?.(0.95);

  // 3) Collect components.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }

  const clusters: Cluster[] = [...groups.values()].map((members) => {
    const sorted = [...members].sort(
      (a, b) =>
        input[b]!.volume - input[a]!.volume || input[a]!.keyword.localeCompare(input[b]!.keyword),
    );
    const methods = new Set(members.map((m) => method[m]!));
    return {
      name: input[sorted[0]!]!.keyword,
      keywords: sorted.map((m) => input[m]!.keyword),
      totalVolume: members.reduce((s, m) => s + input[m]!.volume, 0),
      method:
        members.length === 1
          ? 'single'
          : methods.has('serp')
            ? 'serp'
            : methods.has('embedding')
              ? 'embedding'
              : 'lexical',
    };
  });
  clusters.sort((a, b) => b.totalVolume - a.totalVolume || a.name.localeCompare(b.name));
  opts.onProgress?.(1);
  return clusters;
}
