/**
 * Çoklu BYOK "yedek motor" + düşük-kota failover — SAF çekirdek (electron'suz,
 * birim-test edilebilir). Main süreci (index.ts) ve Ayarlar UI'ı bu modülü
 * paylaşır; hiçbir fonksiyon diske, ağa ya da secret broker'a dokunmaz.
 *
 * İki kavram:
 *  1) ADLANDIRILMIŞ UÇ NOKTALAR (`ByokEndpoint`): eski "tek OpenAI anahtar slotu"
 *     yerine her biri KENDİ base-URL'i + anahtarı + varsayılan modeli olan birden
 *     çok OpenAI-uyumlu uç nokta. İsteğe bağlı `anthropicBaseUrl` varsa aynı uç
 *     nokta Anthropic teliyle (Claude Code'un ANTHROPIC_BASE_URL /
 *     ANTHROPIC_AUTH_TOKEN override'ı) da kullanılabilir.
 *     Anahtarlar BURADA DEĞİL: secret broker'da `endpointKeyRef(id)` altında,
 *     yalnızca-yazılır ve şifreli (Electron safeStorage) durur.
 *  2) YEDEK MOTOR (`QuotaFailoverConfig`): BASİT, MANUEL bir bayrak. Kullanıcı
 *     (ya da god) Claude kotası düştüğünde (ör. %20 altı) Ayarlar'dan bayrağı
 *     açar; kapsamdaki ajanlar bir sonraki başlatılışta yedek motorla başlar.
 *     god + Developer varsayılan olarak muaf.
 *  3) OTOMATİK GEÇİŞ (`QuotaFailoverConfig.auto`): motor sağlığı
 *     shared/engineHealth.ts'de; ajan yalnız kendi motoru kapalıyken yedeğe geçer.
 */

/** Bir uç noktanın konuşabildiği tel protokolleri. */
export type EndpointWire = 'openai' | 'anthropic';

export interface ByokEndpoint {
  /** Kısa, kalıcı kimlik (slug). OpenCode sağlayıcı adı ve `<id>/<model>`
   *  önekidir; anahtar `apikey:endpoint:<id>` altında saklanır. */
  id: string;
  /** Ayarlar'da görünen ad. */
  label: string;
  /** OpenAI-uyumlu base-URL (…/v1). Boşsa OpenAI teli kapalıdır. */
  baseUrl?: string;
  /** Anthropic-uyumlu base-URL (Claude Code ANTHROPIC_BASE_URL). Boşsa uç nokta
   *  Claude motorunun yedeği OLAMAZ (yalnız OpenCode/Crush/Qwen kullanabilir). */
  anthropicBaseUrl?: string;
  /** Varsayılan model slug'ı (önek YOK — ör. 'glm-5.3'). */
  defaultModel?: string;
  /** Model seçicide önerilecek modeller. */
  models?: string[];
  /** false ⇒ uç nokta tanımlı ama hiçbir yerde kullanılmaz. Varsayılan true. */
  enabled?: boolean;
}

/** Bir ajanın sabitlenmiş (pin) motor seçimi: ajan → uç nokta (+model). */
export interface AgentEnginePin {
  endpointId: string;
  model?: string;
}

export interface QuotaFailoverConfig {
  /** Yedek motor bayrağı. true ⇒ kapsamdaki ajanlar bir sonraki başlatılışta
   *  yedek motorla başlar. Varsayılan KAPALI. Otomatik kota izleme yoktur:
   *  kullanıcı Claude kotası düşünce (ör. %20 altı) bu bayrağı açar. */
  enabled: boolean;
  /** Kapsamdaki ajanlar: ajan id'si, rol ya da `*` jokerli desen
   *  (ör. 'worker-*'). Boş liste ⇒ hiçbir ajan geçmez. */
  agents: string[];
  /** Asla geçmeyecek ajanlar (id ya da rol, büyük/küçük harf duyarsız).
   *  Varsayılan ['god', 'developer']. */
  exempt: string[];
  /** Yedek uç nokta sırası; ilk uygun (etkin + anahtarı olan + gereken teli
   *  destekleyen) olan seçilir. */
  fallbackOrder: string[];
  /** Yedeğe geçerken kullanılacak model (uç noktanın defaultModel'ini ezer). */
  fallbackModel?: Record<string, string>;
  /** Otomatik geçiş: kapsamdaki ajan YALNIZ kendi motoru kapalıyken (limit,
   *  kota azaldı, zaman aşımı… — shared/engineHealth.ts) sıradaki sağlıklı
   *  motora geçer, motor açılınca geri döner. Varsayılan KAPALI. */
  auto: boolean;
}

/** Hazır ön ayarlar. Anahtar YOK — kullanıcı Ayarlar'dan girer. */
export const EVREN_ENDPOINT: ByokEndpoint = {
  id: 'evren',
  label: 'EVREN LLM Gateway',
  baseUrl: 'https://evren-llmapi.ssyz.org.tr/v1',
  anthropicBaseUrl: 'https://evren-llmapi.ssyz.org.tr',
  defaultModel: 'glm-5.3',
  models: ['glm-5.3', 'deepseek-v4.1-flash', 'mimo-v2.6-pro', 'qwen3.8-flash-next'],
  enabled: true
};

export const NVIDIA_ENDPOINT: ByokEndpoint = {
  id: 'nvidia',
  label: 'NVIDIA NIM',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  defaultModel: 'deepseek-ai/deepseek-v4.1-flash',
  models: ['deepseek-ai/deepseek-v4.1-flash', 'google/gemma-4-31b-it', 'meta/llama-3.2-90b-vision-instruct'],
  enabled: true
};

/** Moonshot Kimi — platform.kimi.ai/docs/guide/claude-code-kimi (2026-10).
 *  `kimi-k2.7-code` bilerek listede YOK: düşünme modu zorunlu, Claude Code'da
 *  Thinking kapalıyken 400 döner. Çin içi hesaplar için .cn alan adı gerekir. */
export const KIMI_ENDPOINT: ByokEndpoint = {
  id: 'kimi',
  label: 'Moonshot Kimi',
  baseUrl: 'https://api.moonshot.ai/v1',
  anthropicBaseUrl: 'https://api.moonshot.ai/anthropic',
  defaultModel: 'kimi-k3',
  models: ['kimi-k3', 'kimi-k3.1-pro', 'kimi-k2.6'],
  enabled: true
};

/** OpenAI API (ChatGPT'nin motoru) — developers.openai.com/api/docs/pricing
 *  (2026-10). Kimlik 'openai' değil: o ad eski tek-anahtar slotuna ayrılmış.
 *  Anthropic teli YOK ⇒ yalnız OpenCode ajanlarının yedeği olur. API kullanımı
 *  token başına ücretlidir (ChatGPT aboneliğinin limitleri API'de geçmez). */
export const CHATGPT_ENDPOINT: ByokEndpoint = {
  id: 'chatgpt',
  label: 'OpenAI (ChatGPT)',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-6.1-sol',
  models: ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6-astra'],
  enabled: true
};

export const DEFAULT_BYOK_ENDPOINTS: ByokEndpoint[] = [EVREN_ENDPOINT, NVIDIA_ENDPOINT, KIMI_ENDPOINT, CHATGPT_ENDPOINT];

/** Google Gemini API (AI Studio anahtarı) — OpenAI uyumlu adres:
 *  ai.google.dev/gemini-api/docs/openai. Kimlik 'gemini' değil: o ad eski tek
 *  anahtar yuvasına ayrılmış. Anthropic teli YOK ⇒ OpenCode ajanları ve taşma
 *  kullanır; Gemini CLI ajanları kendi Google oturumuyla çalışmaya devam eder.
 *  Model listesi "Bağlantıyı test et" ile sağlayıcıdan güncellenir. */
export const GEMINI_ENDPOINT: ByokEndpoint = {
  id: 'gemini-api',
  label: 'Google Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  // Takma adlar: Google her zaman güncel sürüme yönlendirir (2026-11: 2.5
  // modelleri bu adreste "Not Found" dönüyor).
  defaultModel: 'gemini-flash-latest',
  models: ['gemini-flash-latest', 'gemini-pro-latest', 'gemini-flash-lite-latest'],
  enabled: true
};

/** Bu bilgisayardaki Ollama — anahtar istemez, token harcamaz. Varsayılan
 *  listede değil (Ollama kurulu olmayabilir); Ayarlar'daki "Motor ekle"den gelir. */
export const OLLAMA_ENDPOINT: ByokEndpoint = {
  id: 'ollama',
  label: 'Yerel Ollama',
  baseUrl: 'http://localhost:11434/v1',
  defaultModel: 'emrettc-genel',
  enabled: true
};

/** Ayarlar → Motor ekle düğmeleri: hazır motorlar, yerel olan başta. */
export const ENDPOINT_PRESETS: ByokEndpoint[] = [OLLAMA_ENDPOINT, ...DEFAULT_BYOK_ENDPOINTS, GEMINI_ENDPOINT];

export const DEFAULT_QUOTA_FAILOVER: QuotaFailoverConfig = {
  enabled: false,
  agents: [],
  exempt: ['god', 'developer'],
  // Ücretli OpenAI en sonda: önce ücretsiz/abonelikli motorlar tükensin.
  fallbackOrder: ['evren', 'kimi', 'nvidia', 'chatgpt'],
  auto: false
};

/** Secret broker anahtar referansı. Eski `apikey:<backend>` slotlarıyla çakışmaz. */
export const endpointKeyRef = (id: string): string => `apikey:endpoint:${id}`;

/** OpenCode config'inde `{env:…}` ile başvurulan, spawn'da enjekte edilen env adı.
 *  Anahtar böylece OPENCODE_CONFIG_CONTENT JSON'una hiç yazılmaz. */
export const endpointKeyEnv = (id: string): string =>
  `BYOK_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Eski BACKEND_KEY_ENV / OpenCode yerleşik sağlayıcı adlarıyla çakışmayı önle. */
const RESERVED_IDS = new Set(['anthropic', 'openai', 'google', 'gemini', 'openrouter', 'groq', 'local']);

export function isValidEndpointId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id) && !RESERVED_IDS.has(id);
}

function isHttpUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !u.trim()) return false;
  try {
    const p = new URL(u.trim());
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch { return false; }
}

const trimSlash = (u: string): string => u.trim().replace(/\/+$/, '');

/** Ollama / LM Studio gibi bu makinede çalışan uç noktalar anahtar istemez;
 *  OpenAI-uyumlu istemciler yine de boş olmayan bir anahtar beklediğinden bu
 *  sahte değer gönderilir. */
export const LOCAL_ENDPOINT_KEY = 'ollama';

function isLoopbackUrl(u: string | undefined): boolean {
  if (!u) return false;
  try {
    const h = new URL(u).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
  } catch { return false; }
}

/** Uç nokta bu makinede mi (loopback)? Yerel uç noktalar anahtarsız kullanılabilir. */
export function isLocalEndpoint(e: Pick<ByokEndpoint, 'baseUrl' | 'anthropicBaseUrl'> | undefined): boolean {
  return !!e && (isLoopbackUrl(e.baseUrl) || isLoopbackUrl(e.anthropicBaseUrl));
}

/** Yerel uç noktanın Anthropic teli: Claude Code base-URL'e kendisi `/v1/messages`
 *  ekler, bu yüzden `/v1` ile biten adres `/v1/v1/messages`'a gidip 404 alır.
 *  Ollama aynı portta Anthropic API'sini de sunduğundan, Anthropic adresi
 *  girilmemişse OpenAI adresinden türetilir. Uzak uç noktalara dokunulmaz. */
function localAnthropicUrl(baseUrl: string | undefined, anthropicBaseUrl: string | undefined): string | undefined {
  const src = anthropicBaseUrl ?? baseUrl;
  if (!src || !isLoopbackUrl(src)) return anthropicBaseUrl;
  return src.replace(/\/v1$/, '');
}

/** Diskten/IPC'den gelen ham listeyi doğrula + normalize et. Geçersiz kayıtlar
 *  atlanır, yinelenen id'lerde ilki kazanır. Asla fırlatmaz. */
export function normalizeEndpoints(raw: unknown): ByokEndpoint[] {
  if (!Array.isArray(raw)) return [];
  const out: ByokEndpoint[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Record<string, unknown>;
    if (!isValidEndpointId(e.id) || seen.has(e.id)) continue;
    const baseUrl = isHttpUrl(e.baseUrl) ? trimSlash(e.baseUrl) : undefined;
    const anthropicBaseUrl = localAnthropicUrl(baseUrl, isHttpUrl(e.anthropicBaseUrl) ? trimSlash(e.anthropicBaseUrl) : undefined);
    if (!baseUrl && !anthropicBaseUrl) continue; // hiçbir teli olmayan uç nokta işe yaramaz
    const models = Array.isArray(e.models)
      ? e.models.filter((m): m is string => typeof m === 'string' && !!m.trim()).map((m) => m.trim())
      : undefined;
    seen.add(e.id);
    out.push({
      id: e.id,
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : e.id,
      ...(baseUrl ? { baseUrl } : {}),
      ...(anthropicBaseUrl ? { anthropicBaseUrl } : {}),
      ...(typeof e.defaultModel === 'string' && e.defaultModel.trim() ? { defaultModel: e.defaultModel.trim() } : {}),
      ...(models && models.length ? { models } : {}),
      enabled: e.enabled !== false
    });
  }
  return out;
}

const strList = (v: unknown, d: string[]): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim()) : d;

/** Kısmi/eksik failover config'ini varsayılanlarla derin-doldur. */
export function normalizeQuotaFailover(raw: unknown): QuotaFailoverConfig {
  const d = DEFAULT_QUOTA_FAILOVER;
  if (!raw || typeof raw !== 'object') return { ...d, agents: [...d.agents], exempt: [...d.exempt], fallbackOrder: [...d.fallbackOrder] };
  const r = raw as Record<string, unknown>;
  const fm = r.fallbackModel && typeof r.fallbackModel === 'object'
    ? Object.fromEntries(Object.entries(r.fallbackModel as Record<string, unknown>)
      .filter(([k, v]) => isValidEndpointId(k) && typeof v === 'string' && !!v.trim())
      .map(([k, v]) => [k, (v as string).trim()]))
    : undefined;
  return {
    enabled: r.enabled === true,
    agents: strList(r.agents, [...d.agents]),
    exempt: strList(r.exempt, [...d.exempt]),
    fallbackOrder: strList(r.fallbackOrder, [...d.fallbackOrder]).filter(isValidEndpointId),
    ...(fm && Object.keys(fm).length ? { fallbackModel: fm } : {}),
    auto: r.auto === true
  };
}

// ─── Ajan eşleme + motor çözümleme ───────────────────────────────────────────

export interface AgentIdent {
  id: string;
  role?: string;
  isGod?: boolean;
}

function globToRe(p: string): RegExp {
  const esc = p.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`);
}

function matchesAny(agent: AgentIdent, patterns: string[]): boolean {
  const keys = [agent.id, agent.role].filter((s): s is string => !!s).map((s) => s.toLowerCase());
  return patterns.some((p) => {
    const re = globToRe(p.trim());
    return keys.some((k) => re.test(k));
  });
}

/** Ajan muaf mı? exempt listesi id/rol ile eşleşir; listede 'god' varsa
 *  orkestratör (isGod) id'si ne olursa olsun muaftır. */
export function isFailoverExempt(agent: AgentIdent, cfg: QuotaFailoverConfig): boolean {
  // Yönetici (Genel Müdür) her zaman muaf: ücretli motorun son %40'ı ona ayrılır
  // (Emre 2026-11-03) — işçiler %60'ta taşınırken yönetici Claude'da kalır. Ona
  // başka motor ancak AÇIK pinle verilir (resolveAgentEngine pin yolu).
  if (agent.isGod) return true;
  return matchesAny(agent, cfg.exempt);
}

export function isFailoverCandidate(agent: AgentIdent, cfg: QuotaFailoverConfig): boolean {
  return !isFailoverExempt(agent, cfg) && matchesAny(agent, cfg.agents);
}

/** Çözümlenmiş motor: Claude motorunu yönlendirmek için gereken her şey. */
export interface ResolvedEngine {
  endpoint: ByokEndpoint;
  model: string;
  wire: EndpointWire;
  source: 'pin' | 'failover';
}

/** Uç noktayı, istenen tel için kullanılabilir mi? (etkin + URL + anahtar; yerel uç nokta anahtarsız) */
export function endpointUsable(e: ByokEndpoint | undefined, wire: EndpointWire, hasKey: (id: string) => boolean): e is ByokEndpoint {
  if (!e || e.enabled === false) return false;
  if (wire === 'anthropic' && !e.anthropicBaseUrl) return false;
  if (wire === 'openai' && !e.baseUrl) return false;
  return hasKey(e.id) || isLocalEndpoint(e);
}

/**
 * Bir ajanın spawn anında hangi motorla başlayacağını çöz.
 * Öncelik: (1) açık pin (agentEngines) > (2) yedek motor bayrağı > (3) null = varsayılan.
 * `wire`: Claude Code ajanı için 'anthropic', OpenCode için 'openai'.
 * Muaf ajanlar (god/Developer) failover'dan etkilenmez; ama kullanıcı onlara
 * BİLEREK pin koyduysa o pin uygulanır (açık seçim her zaman kazanır).
 *
 * Otomatik mod (`failover.auto` + `isDown`): ajanın asıl motoru — pinliyse pin
 * uç noktası, değilse Anthropic telinde yerel Claude ('claude') — kapalıysa
 * fallbackOrder'daki ilk SAĞLIKLI uç noktaya geçilir. Sağlıklı yedek yoksa asıl
 * motorda kalınır (hiç motorsuz kalmaktansa denemeye devam).
 */
export function resolveAgentEngine(args: {
  agent: AgentIdent;
  wire: EndpointWire;
  endpoints: ByokEndpoint[];
  pins?: Record<string, AgentEnginePin>;
  failover: QuotaFailoverConfig;
  hasKey: (id: string) => boolean;
  /** Motor şu an kapalı mı? ('claude' ya da uç nokta kimliği). */
  isDown?: (engine: string) => boolean;
}): ResolvedEngine | null {
  const { agent, wire, endpoints, pins, failover, hasKey } = args;
  const isDown = args.isDown ?? (() => false);
  const byId = new Map(endpoints.map((e) => [e.id, e]));
  const autoOn = failover.auto && isFailoverCandidate(agent, failover);
  // Önce kullanıcının sırası; sonra sıraya yazılmamış ama etkin + anahtarlı uç
  // noktalar son çare olarak — ofis, listede unutulmuş sağlıklı bir motor
  // varken durmasın (ör. sonradan eklenen Kimi).
  const order = [...failover.fallbackOrder, ...endpoints.map((e) => e.id).filter((id) => !failover.fallbackOrder.includes(id))];
  const firstHealthy = (skip: string): ResolvedEngine | null => {
    for (const id of order) {
      if (id === skip || isDown(id)) continue;
      const e = byId.get(id);
      if (!endpointUsable(e, wire, hasKey)) continue;
      const model = failover.fallbackModel?.[id] || e.defaultModel;
      if (model) return { endpoint: e, model, wire, source: 'failover' };
    }
    return null;
  };
  const pin = pins?.[agent.id];
  if (pin) {
    const e = byId.get(pin.endpointId);
    if (endpointUsable(e, wire, hasKey)) {
      const model = pin.model?.trim() || e.defaultModel;
      if (model) {
        const pinned: ResolvedEngine = { endpoint: e, model, wire, source: 'pin' };
        // Yerel motora pinli ajan HİÇ geçmez, kendi motorunda yeniden dener:
        //  - ücretli uç noktaya taşınmamalı (kullanıcı token harcamasın diye yerele bağladı);
        //  - başka bir yerel modele de taşınmamalı: hepsi aynı ekran kartını paylaşır,
        //    yerel motorun "kapalı" görünmesi çoğu zaman yeniden başlatmadır ve yedek
        //    yerel model (ör. 30B kod modeli) belleğe sığmayıp işlemcide sürünür
        //    (2026-11-03: bütün ajanlar emrettc-kod'a geçip RAM'i 22 GB doldurdu).
        if (autoOn && isDown(e.id)) return isLocalEndpoint(e) ? pinned : firstHealthy(e.id) ?? pinned;
        return pinned;
      }
    }
  }
  // Otomatik mod açıkken manuel bayrak yok sayılır: ikisi birlikte "kapsamdaki
  // herkes sağlıklı motordan bile zorla yedeğe" anlamına gelirdi.
  if (failover.enabled && !failover.auto && isFailoverCandidate(agent, failover)) {
    for (const id of failover.fallbackOrder) {
      const e = byId.get(id);
      if (!endpointUsable(e, wire, hasKey)) continue;
      const model = failover.fallbackModel?.[id] || e.defaultModel;
      if (model) return { endpoint: e, model, wire, source: 'failover' };
    }
  }
  if (autoOn && wire === 'anthropic' && !pin && isDown('claude')) return firstHealthy('claude');
  return null;
}

/**
 * Claude Code'u bir Anthropic-uyumlu uç noktaya yönlendiren env. Anahtar
 * çağıran tarafından (MAIN-only, secret broker'dan) verilir; bu fonksiyon onu
 * yalnızca env haritasına koyar — asla loglamaz.
 * Tüm model katmanları (opus/sonnet/haiku/subagent) aynı modele sabitlenir;
 * aksi halde Claude Code arka plan çağrılarında yedek uç noktada olmayan bir
 * `claude-haiku-*` modelini ister ve hata alır.
 */
export function claudeEngineEnv(engine: ResolvedEngine, apiKey: string): Record<string, string> {
  if (engine.wire !== 'anthropic' || !engine.endpoint.anthropicBaseUrl) return {};
  const m = engine.model;
  return {
    ANTHROPIC_BASE_URL: engine.endpoint.anthropicBaseUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    // Abonelik OAuth / eski API anahtarı yedek uç noktaya sızmasın.
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: m,
    ANTHROPIC_DEFAULT_OPUS_MODEL: m,
    ANTHROPIC_DEFAULT_SONNET_MODEL: m,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: m,
    ANTHROPIC_SMALL_FAST_MODEL: m,
    CLAUDE_CODE_SUBAGENT_MODEL: m,
    // Anthropic'e telemetri/güncelleme trafiği yedek modda gitmesin.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    HIVE_ENGINE: `${engine.endpoint.id}/${m}`
  };
}

/** `--model X` argümanını (varsa) değiştir, yoksa ekle. Yeni dizi döner. */
export function withModelArg(args: string[], model: string): string[] {
  const out = [...args];
  const i = out.indexOf('--model');
  if (i >= 0 && i + 1 < out.length) out[i + 1] = model;
  else out.push('--model', model);
  return out;
}

export const OPENCODE_HEADER_TIMEOUT_MS = 90_000;
/** Yerel model ilk istekte diske/VRAM'e yüklenir ve uzun ajan istemini CPU'da
 *  işler; kuyrukta (sıra görevlisinde, main/localGate.ts) bekleyen ajanlar da bu
 *  süreyi paylaşır — sıra beklemesi dakikalar sürebilir. 90 sn'lik bulut
 *  sınırı yerel motoru haksız yere "kapalı" sayıp ajanları ücretli motora
 *  taşıyordu. */
export const LOCAL_HEADER_TIMEOUT_MS = 60 * 60_000;

/**
 * OpenCode `provider` bloğu: etkin her OpenAI-uyumlu uç nokta bir sağlayıcı
 * olur, böylece `--model evren/glm-5.3` çözümlenir. Anahtar JSON'a YAZILMAZ —
 * `{env:BYOK_<ID>_API_KEY}` ikamesiyle spawn env'inden okunur.
 */
export function opencodeProviders(endpoints: ByokEndpoint[], hasKey: (id: string) => boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of endpoints) {
    if (!endpointUsable(e, 'openai', hasKey)) continue;
    const models = new Set([...(e.models ?? []), ...(e.defaultModel ? [e.defaultModel] : [])]);
    out[e.id] = {
      npm: '@ai-sdk/openai-compatible',
      name: e.label,
      // headerTimeout: OpenCode varsayılanı 5 dk. Takılan bir uç nokta bu kadar
      // beklenirse otomatik geçiş de o kadar gecikir; 90 sn yeterli.
      options: { baseURL: e.baseUrl, apiKey: `{env:${endpointKeyEnv(e.id)}}`, headerTimeout: isLocalEndpoint(e) ? LOCAL_HEADER_TIMEOUT_MS : OPENCODE_HEADER_TIMEOUT_MS },
      models: Object.fromEntries([...models].map((m) => [m, isLocalEndpoint(e)
        // Bağlam sınırı bilinsin ki OpenCode konuşmayı pencere dolmadan özetlesin.
        ? { name: m, limit: { context: LOCAL_CONTEXT_WINDOW, output: 8192 } }
        : { name: m }]))
    };
  }
  return out;
}

/** `evren/glm-5.3` → { endpointId:'evren', model:'glm-5.3' }; NVIDIA gibi
 *  model adında '/' olanlar için yalnız İLK segment önektir. */
export function splitEndpointModel(slug: string, endpoints: ByokEndpoint[]): AgentEnginePin | null {
  const i = slug.indexOf('/');
  if (i <= 0) return null;
  const id = slug.slice(0, i).toLowerCase();
  if (!endpoints.some((e) => e.id === id)) return null;
  const model = slug.slice(i + 1);
  return model ? { endpointId: id, model } : null;
}

// ─── Ayarlar UI yardımcıları (pin metin düzenleyicisi) ───────────────────────

/** `ajan = uç-nokta/model` satırlarını ayrıştır. Boş/# satırlar atlanır;
 *  geçersizler `invalid` içinde döner (UI uyarır, kaydetmez). */
export function parsePinLines(text: string, endpoints: ByokEndpoint[]): {
  pins: Record<string, AgentEnginePin>;
  invalid: string[];
} {
  const pins: Record<string, AgentEnginePin> = {};
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    const agent = eq > 0 ? line.slice(0, eq).trim() : '';
    const target = eq > 0 ? line.slice(eq + 1).trim() : '';
    if (!agent || !/^[A-Za-z0-9._-]+$/.test(agent) || !target) { invalid.push(line); continue; }
    const split = splitEndpointModel(target, endpoints);
    if (split) { pins[agent] = split; continue; }
    // Yalnız uç nokta kimliği ⇒ onun varsayılan modeli.
    const id = target.toLowerCase();
    if (endpoints.some((e) => e.id === id)) { pins[agent] = { endpointId: id }; continue; }
    invalid.push(line);
  }
  return { pins, invalid };
}

/** parsePinLines'ın tersi — kalıcı pinleri düzenlenebilir metne çevir. */
export function formatPins(pins: Record<string, AgentEnginePin> | undefined): string {
  return Object.entries(pins ?? {})
    .map(([a, p]) => `${a} = ${p.endpointId}${p.model ? `/${p.model}` : ''}`)
    .join('\n');
}

/** Virgüllü listeyi diziye çevir (UI alanları için). */
export function splitList(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

// ─── Yerel motorda hafif istem ───────────────────────────────────────────────
// Yerel modelde zamanın çoğu istemi OKUMAYA gider (her istekte ~15k token). Ölçüm
// (2026-11-03): OpenCode sistem isteminin 2/3'ü bilgisayardaki bütün Claude
// becerilerinin listesi, araçların ~8k karakteri otonom ajanın kullanmadığı
// alt-ajan/yapılacaklar/soru araçları; Claude Code'da MCP araçları ve eklenti
// kancaları (superpowers) istemi 40-80k karaktere çıkarıyor. Yerel motordaki
// işçilerde bunlar kapatılır; API motorları ve yönetici olduğu gibi kalır.

/** Yerel modellerin bağlam penceresi (Modelfile num_ctx = 65536). İstemciler
 *  bunu bilmezse konuşmayı hiç özetlemez (Claude Code bilinmeyen modeli 200k
 *  sanar): konuşma pencereyi aşar, Ollama her istekte keser ve baştan okur. */
export const LOCAL_CONTEXT_WINDOW = 65536;

/** OpenCode'da yerel motorda kapatılan araçlar. */
export const LOCAL_LEAN_OPENCODE_TOOLS_OFF = ['task', 'todowrite', 'question'] as const;

/** OpenCode yerel motor: ~/.claude/skills listesi isteme girmesin. */
export const LOCAL_LEAN_OPENCODE_ENV: Readonly<Record<string, string>> = { OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1' };
