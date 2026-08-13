import { ConfigSource } from "./ConfigSource";

export class InMemoryConfigSource implements ConfigSource {
  readonly kind = "memory" as const;
  private reads = 0;

  constructor(private readonly document: unknown) {}

  async load(): Promise<unknown> {
    this.reads += 1;
    return this.document;
  }

  readCount(): number {
    return this.reads;
  }
}
