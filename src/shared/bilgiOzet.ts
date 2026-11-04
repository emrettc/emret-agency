/**
 * Ortak bilgi hafızası kullanım defterinin (<hive>/bilgi/kullanim.jsonl) özeti.
 * resources/bilgi.cjs `summarize` ile AYNI kurallar — o dosya asar dışında düz
 * node ile çalıştığı için main ondan import edemez; test ikisini karşılaştırır.
 */
export interface BilgiOzet {
  aramalar: number;
  isabetliAramalar: number;
  /** TAHMİNİ: hafızadan karşılanan notların ilk araştırma maliyeti toplamı. */
  tasarrufToken: number;
  kayitlar: number;
  /** Ajan başına tahmini tasarruf (hafızadan bilgiyi BULAN ajana yazılır). */
  ajanlar: Record<string, number>;
}

export function summarizeBilgiUsage(jsonl: string): BilgiOzet {
  let aramalar = 0;
  let tasarrufToken = 0;
  let kayitlar = 0;
  const hitSearches = new Set<string>();
  const ajanlar: Record<string, number> = {};
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let u: { kind?: string; ajan?: string; ts?: number; tasarruf?: number };
    try { u = JSON.parse(line); } catch { continue; }
    if (u.kind === 'ara') aramalar++;
    else if (u.kind === 'kaydet') kayitlar++;
    else if (u.kind === 'isabet') {
      const t = Number(u.tasarruf) || 0;
      tasarrufToken += t;
      if (u.ajan) ajanlar[u.ajan] = (ajanlar[u.ajan] || 0) + t;
      hitSearches.add(`${u.ajan}|${u.ts}`);
    }
  }
  return { aramalar, isabetliAramalar: hitSearches.size, tasarrufToken, kayitlar, ajanlar };
}
