/** Maps provider identities to application segments; completion arrival order is irrelevant. */
export class RealtimeSegmentMap {
  private readonly itemToSegment = new Map<string, string>();
  private readonly segmentToItem = new Map<string, string>();
  private readonly pending: string[] = [];
  private active: string | null = null;

  begin(segmentId: string): void {
    if (this.active) throw new Error('SEGMENT_ALREADY_ACTIVE');
    this.active = segmentId;
  }
  commit(segmentId: string): void {
    if (this.active !== segmentId) throw new Error('SEGMENT_NOT_ACTIVE');
    if (!this.segmentToItem.has(segmentId)) this.pending.push(segmentId);
    this.active = null;
  }
  resolve(itemId: string): string {
    const mapped = this.itemToSegment.get(itemId);
    if (mapped) return mapped;
    const segmentId = this.pending.shift() ?? this.active;
    if (!segmentId || this.segmentToItem.has(segmentId)) throw new Error('UNMAPPED_PROVIDER_ITEM');
    this.itemToSegment.set(itemId, segmentId);
    this.segmentToItem.set(segmentId, itemId);
    return segmentId;
  }
}
