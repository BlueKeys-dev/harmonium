import { KEY_COUNT } from "./pitch";
import type { TeachInputSource } from "./teachSession";

export interface RoutedNoteDown {
  key: number;
  sourceId: string;
  source: TeachInputSource;
  atMs: number;
}

interface InputRouterOptions {
  startNote: (key: number) => boolean;
  stopNote: (key: number) => void;
  noteDown: (event: RoutedNoteDown) => void;
}

interface HeldInput {
  key: number;
  source: TeachInputSource;
}

/** Own note-down/up by physical source so overlapping inputs cannot cut each other off. */
export class InputRouter {
  private readonly held = new Map<string, HeldInput>();
  private readonly owners = new Map<number, Set<string>>();

  constructor(private readonly options: InputRouterOptions) {}

  press(sourceId: string, key: number, source: TeachInputSource, atMs: number): boolean {
    if (!sourceId || !Number.isInteger(key) || key < 0 || key >= KEY_COUNT) return false;
    const existing = this.held.get(sourceId);
    if (existing?.key === key) return false;
    if (existing) this.release(sourceId);

    const owners = this.owners.get(key) ?? new Set<string>();
    const startsReed = owners.size === 0;
    if (startsReed && !this.options.startNote(key)) return false;

    owners.add(sourceId);
    this.owners.set(key, owners);
    this.held.set(sourceId, { key, source });
    if (startsReed) this.options.noteDown({ key, sourceId, source, atMs });
    return true;
  }

  release(sourceId: string): void {
    const held = this.held.get(sourceId);
    if (!held) return;
    this.held.delete(sourceId);
    const owners = this.owners.get(held.key);
    owners?.delete(sourceId);
    if (owners && owners.size > 0) return;
    this.owners.delete(held.key);
    this.options.stopNote(held.key);
  }

  releaseAll(): void {
    for (const sourceId of [...this.held.keys()]) this.release(sourceId);
  }

  heldCount(): number {
    return this.held.size;
  }
}
