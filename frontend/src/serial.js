// Thin wrapper around the Web Serial API (Chrome / Edge desktop, needs HTTPS or localhost).
export const serialSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

export class SerialLink {
  constructor(onLine, onState) {
    this.onLine = onLine;
    this.onState = onState;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.running = false;
  }
  static async previousPort() {
    const ports = await navigator.serial.getPorts();
    return ports[0] || null;
  }
  async connect(existing) {
    const port = existing || (await navigator.serial.requestPort());
    await port.open({ baudRate: 9600 });
    this.port = port;
    this.writer = port.writable.getWriter();
    this.running = true;
    this.onState("connected");
    this.loop();
  }
  async loop() {
    const dec = new TextDecoder();
    this.reader = this.port.readable.getReader();
    let buf = "";
    try {
      while (this.running) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) this.onLine(line);
        }
      }
    } catch {
      /* cable unplugged */
    } finally {
      try { this.reader.releaseLock(); } catch {}
      await this.cleanup();
    }
  }
  async send(line) {
    if (!this.writer) return;
    await this.writer.write(new TextEncoder().encode(line.replace(/[\r\n]/g, " ") + "\n"));
  }
  async disconnect() {
    this.running = false;
    try { await this.reader?.cancel(); } catch {}
  }
  async cleanup() {
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = this.writer = this.reader = null;
    this.running = false;
    this.onState("disconnected");
  }
}
