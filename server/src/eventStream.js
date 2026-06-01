// SSE hub. One subscriber set per sessionId. Backend pushes typed events; the
// frontend reducer applies them to its store.

class EventBus {
  constructor() {
    this.subs = new Map(); // sessionId -> Set<reply>
    this.buffers = new Map(); // sessionId -> events[] (so a late subscriber can catch up)
    this.MAX_BUFFER = 5000;
  }

  subscribe(sessionId, reply) {
    if (!this.subs.has(sessionId)) this.subs.set(sessionId, new Set());
    this.subs.get(sessionId).add(reply);

    // Flush buffered events so the UI sees the run-in-progress state.
    const buf = this.buffers.get(sessionId) || [];
    for (const ev of buf) this._write(reply, ev);

    reply.raw.on('close', () => {
      this.subs.get(sessionId)?.delete(reply);
    });
  }

  emit(sessionId, event) {
    const ev = { ...event, ts: event.ts || new Date().toISOString() };
    const buf = this.buffers.get(sessionId) || [];
    buf.push(ev);
    if (buf.length > this.MAX_BUFFER) buf.splice(0, buf.length - this.MAX_BUFFER);
    this.buffers.set(sessionId, buf);

    const subs = this.subs.get(sessionId);
    if (!subs) return;
    for (const reply of subs) this._write(reply, ev);
  }

  clear(sessionId) {
    this.buffers.delete(sessionId);
  }

  _write(reply, ev) {
    try {
      reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    } catch {
      // socket may be closed; cleanup will handle removal
    }
  }
}

export const bus = new EventBus();
