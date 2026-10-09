import { one } from '../db/client.js';
import type { TranscriptSegment } from '@devday/contracts';
import type { Actor, ApplicationPorts, MediaStore } from '@devday/application-ports';
import { SpeechService } from './speech.js';
import type { MediaMetadata, MediaMetadataRepository } from '../storage/media.js';
import { DomainError, requireValue } from './errors.js';
export class DomainService extends SpeechService {
  readonly mediaRepository: MediaMetadataRepository = {
    insert: async (record) => {
      await this.db.pool.query(
        'INSERT INTO media(id,study_id,segment_id,kind,storage_key,content_type) VALUES($1,$2,$3,$4,$5,$6)',
        [
          record.id,
          record.studyId,
          record.segmentId,
          record.kind,
          record.storageKey,
          record.contentType,
        ],
      );
    },
    findBySegment: async (segmentId) => {
      const row = (
        await this.db.pool.query(
          "SELECT id FROM media WHERE segment_id=$1 AND kind='audio' LIMIT 1",
          [segmentId],
        )
      ).rows[0];
      return row ? this.mediaRepository.findById(row.id) : undefined;
    },
    findById: async (mediaId) => {
      const row = (
        await this.db.pool.query(
          'SELECT id,study_id,segment_id,kind,storage_key,content_type FROM media WHERE id=$1',
          [mediaId],
        )
      ).rows[0];
      return row
        ? ({
            id: row.id,
            studyId: row.study_id,
            segmentId: row.segment_id,
            kind: row.kind,
            storageKey: row.storage_key,
            contentType: row.content_type,
          } as MediaMetadata)
        : undefined;
    },
  };
  async resolveSegmentAudio(actor: Actor, segmentId: string) {
    const segment = requireValue(
      await one<TranscriptSegment>(
        this.db.pool,
        'SELECT data FROM transcript_segments WHERE id=$1',
        [segmentId],
      ),
    );
    await this.assertMember(actor, segment.studyId);
    return requireValue(this.mediaStore).readSegmentAudio(segmentId);
  }
  async resolveMedia(actor: Actor, mediaId: string) {
    const media = requireValue(await this.mediaRepository.findById(mediaId));
    if (media.kind !== 'image')
      throw new DomainError('NOT_FOUND', '이미지를 찾을 수 없습니다.', 404);
    await this.assertMember(actor, media.studyId);
    return requireValue(this.mediaStore).resolveImage(mediaId);
  }
  ports(media: MediaStore): ApplicationPorts {
    this.mediaStore = media;
    return {
      studyCommands: { execute: (actor, input) => this.execute(actor, input) },
      learning: this.learning,
      sharing: this.sharing,
      speech: this.speech,
      feedback: this.feedback,
      topicContext: this.topicContext,
      studies: this.studies,
      jobs: this.jobs,
      experiences: this.experiences,
      chat: this.chat,
      events: this.events,
      media,
    };
  }
}
