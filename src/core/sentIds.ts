/**
 * @module core/sentIds
 * Remembers ids of messages the bot itself sent, so when WhatsApp echoes them back
 * (fromMe=true) the dispatcher never treats the bot's own replies as input → no loops.
 */
export class SentIds {
  private set = new Set<string>();
  private order: string[] = [];
  constructor(private max = 1000) {}
  add(id?: string | null) {
    if (!id || this.set.has(id)) return;
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > this.max) this.set.delete(this.order.shift()!);
  }
  has(id?: string | null) { return !!id && this.set.has(id); }
}
