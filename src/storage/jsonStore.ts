/**
 * @module storage/jsonStore
 * Tiny crash-safe JSON persistence (no native deps → works on Termux/VPS/Windows).
 *  - save()  : debounced (300ms) atomic write (tmp file + rename)
 *  - flush() : immediate synchronous write, always (called on shutdown, so even un-saved mutations survive)
 *  - corrupt file → renamed to *.corrupt-<time> and defaults are used
 * Docs: docs/03-STORAGE.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeLog } from '../core/logger.js';

const log = makeLog('store');

export class JsonStore<T extends object> {
  data: T;
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string, private defaults: T) {
    this.data = structuredClone(defaults);
    this.load();
  }

  private load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...structuredClone(this.defaults), ...parsed };
    } catch (err) {
      const bak = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, bak);
      log.error(`Corrupt store ${this.file}; moved to ${bak}. Starting fresh.`, err);
    }
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 300);
    this.timer.unref?.();
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
