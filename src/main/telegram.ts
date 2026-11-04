/**
 * Telegram bağlantısı — ofisi telefondan yönet.
 *
 * Bot API'si UZUN YOKLAMA (getUpdates) ile dinlenir: Slack'teki gibi internete
 * açık bir tünel/port GEREKMEZ, uygulama Telegram'a yalnız dışarı doğru bağlanır.
 *
 * Güvenlik: yalnız eşleştirilmiş sohbetten (config.telegramChatId) gelen mesajlar
 * işlenir; başka biri botu bulsa bile mesajı yok sayılır. Eşleştirme kullanıcının
 * Ayarlar'dan başlattığı kısa bir pencerede, bota yazılan ilk /start ile yapılır.
 * Bot anahtarı main'deki şifreli anahtar deposunda durur, renderer'a hiç gitmez.
 */

const API = 'https://api.telegram.org';
const MAX_TEXT = 3900; // Telegram sınırı 4096; kesme işareti payı

export interface TelegramIncoming { chatId: string; text: string; from: string; messageId: number }

interface TgUpdate {
  update_id: number;
  message?: { message_id: number; text?: string; chat: { id: number; type: string }; from?: { first_name?: string; username?: string } };
}

export class TelegramBridge {
  private offset = 0;
  private running = false;
  private abort: AbortController | null = null;
  private pairing: { until: number; resolve: (chatId: string | null) => void } | null = null;
  botName: string | null = null;
  lastError: string | null = null;

  constructor(private readonly deps: {
    token: () => string | undefined;
    chatId: () => string | undefined;
    onMessage: (m: TelegramIncoming) => void;
  }) {}

  private async call<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal, token = this.deps.token()): Promise<T> {
    if (!token) throw new Error('bot anahtarı yok');
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: signal ?? AbortSignal.timeout(15_000)
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
    if (!body?.ok) throw new Error(body?.description ?? `HTTP ${res.status}`);
    return body.result as T;
  }

  /** Anahtarı doğrula: botun kullanıcı adı döner. */
  async verify(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
    try {
      const me = await this.call<{ username?: string }>('getMe', {}, undefined, token);
      return { ok: true, username: me.username };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }

  isRunning(): boolean { return this.running; }

  start(): void {
    if (this.running || !this.deps.token()) return;
    this.running = true;
    void this.call<{ username?: string }>('getMe').then((me) => { this.botName = me.username ?? null; }).catch(() => { /* yoklama hatayı gösterir */ });
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
    this.abort = null;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        this.abort = new AbortController();
        const timer = setTimeout(() => this.abort?.abort(), 60_000);
        const updates = await this.call<TgUpdate[]>('getUpdates', { offset: this.offset, timeout: 45, allowed_updates: ['message'] }, this.abort.signal);
        clearTimeout(timer);
        this.lastError = null;
        for (const u of updates) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          this.handle(u);
        }
      } catch (e) {
        if (!this.running) break;
        this.lastError = e instanceof Error ? e.message : String(e);
        // Ağ kesintisi / geçersiz anahtar: sakin yeniden dene.
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }

  private handle(u: TgUpdate): void {
    const m = u.message;
    if (!m?.text) return;
    const chatId = String(m.chat.id);
    if (this.pairing && Date.now() < this.pairing.until && m.text.trim().startsWith('/start') && m.chat.type === 'private') {
      const p = this.pairing;
      this.pairing = null;
      p.resolve(chatId);
      return;
    }
    if (!this.deps.chatId() || chatId !== this.deps.chatId()) return; // eşleşmemiş sohbet: yok say
    this.deps.onMessage({ chatId, text: m.text, from: m.from?.first_name ?? m.from?.username ?? 'Telegram', messageId: m.message_id });
  }

  /** Eşleştirme: `seconds` içinde bota /start yazan özel sohbetin kimliği. */
  pair(seconds = 120): Promise<string | null> {
    this.pairing?.resolve(null);
    return new Promise((resolve) => {
      this.pairing = { until: Date.now() + seconds * 1000, resolve };
      setTimeout(() => { if (this.pairing?.resolve === resolve) { this.pairing = null; resolve(null); } }, seconds * 1000);
      this.start();
    });
  }

  async send(text: string, replyTo?: number, chatId = this.deps.chatId()): Promise<{ ok: boolean; error?: string }> {
    if (!chatId) return { ok: false, error: 'sohbet eşleştirilmemiş' };
    const body = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…` : text;
    try {
      await this.call('sendMessage', {
        chat_id: chatId, text: body, disable_web_page_preview: true,
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {})
      });
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
}
