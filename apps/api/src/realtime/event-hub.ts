import {
  EventSchema,
  StudySnapshotMessageSchema,
  type DomainEvent,
  type StudySnapshot,
} from '@devday/contracts';
import type { EventPublisher } from '@devday/application-ports';

export interface EventSocket {
  readyState: number;
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}
export interface EventConnection {
  readonly userId: string;
  readonly socket: EventSocket;
  readonly studies: Map<string, DomainEvent[] | null>;
  closed: boolean;
}

/** Single-process change notifications. Durable truth always comes from PostgreSQL. */
export class EventHub implements EventPublisher {
  private readonly connections = new Set<EventConnection>();

  connect(userId: string, socket: EventSocket): EventConnection {
    const connection: EventConnection = { userId, socket, studies: new Map(), closed: false };
    this.connections.add(connection);
    return connection;
  }

  disconnect(connection: EventConnection): void {
    connection.closed = true;
    connection.studies.clear();
    this.connections.delete(connection);
  }

  /** Call only after membership authorization, before beginning the consistent DB read. */
  beginStudySubscription(
    connection: EventConnection,
    studyId: string,
  ): {
    complete(snapshot: StudySnapshot): void;
    cancel(): void;
  } {
    if (connection.closed) throw new Error('Event connection is closed');
    const buffer: DomainEvent[] = [];
    connection.studies.set(studyId, buffer);
    return {
      complete: (snapshot) => {
        if (connection.closed || connection.studies.get(studyId) !== buffer) return;
        const message = StudySnapshotMessageSchema.parse({
          type: 'study.snapshot',
          studyId,
          snapshot,
        });
        if (snapshot.study.id !== studyId) throw new Error('Snapshot does not match subscription');
        this.send(connection, message);
        // This entire switch/flush is synchronous, so an event cannot overtake its snapshot.
        connection.studies.set(studyId, null);
        for (const event of buffer) this.send(connection, event);
      },
      cancel: () => {
        if (connection.studies.get(studyId) === buffer) connection.studies.delete(studyId);
      },
    };
  }

  async toUser(userId: string, input: DomainEvent): Promise<void> {
    const event = EventSchema.parse(input);
    if (event.scope !== 'user')
      throw new Error('Study event cannot be published to a user channel');
    if ('ownerUserId' in event.payload && event.payload.ownerUserId !== userId) {
      throw new Error('Private event owner does not match recipient');
    }
    for (const connection of this.connections) {
      if (connection.userId === userId) this.send(connection, event);
    }
  }

  async toStudy(studyId: string, input: DomainEvent): Promise<void> {
    const event = EventSchema.parse(input);
    if (event.scope !== 'study' || event.studyId !== studyId)
      throw new Error('Event does not match study scope');
    if ('studyId' in event.payload && event.payload.studyId !== studyId)
      throw new Error('Event payload does not match study scope');
    if (event.type === 'study.changed') {
      if (
        event.payload.study.id !== studyId ||
        (event.payload.topic?.studyId && event.payload.topic.studyId !== studyId) ||
        event.payload.jobs.some((job) => job.scope !== 'study' || job.studyId !== studyId)
      ) {
        throw new Error('Study event contains unrelated or private data');
      }
    }
    for (const connection of this.connections) {
      if (!connection.studies.has(studyId)) continue;
      const buffer = connection.studies.get(studyId);
      if (buffer) {
        if (buffer.length >= 1_000) {
          connection.socket.close(1013, 'Snapshot event buffer exceeded');
          this.disconnect(connection);
        } else buffer.push(event);
      } else this.send(connection, event);
    }
  }

  close(): void {
    for (const connection of this.connections) {
      connection.socket.close(1001, 'Server shutting down');
      this.disconnect(connection);
    }
  }

  private send(connection: EventConnection, message: unknown): void {
    if (connection.closed || connection.socket.readyState !== 1) return;
    try {
      connection.socket.send(JSON.stringify(message));
    } catch {
      this.disconnect(connection);
    }
  }
}
