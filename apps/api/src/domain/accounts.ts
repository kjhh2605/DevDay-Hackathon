import { randomBytes } from 'node:crypto';
import type { Actor } from '@devday/application-ports';
import type {
  User,
  Study,
  Experience,
  ExperienceDraft,
  Invitation,
  EndpointInput,
} from '@devday/contracts';
import { DomainBase, id, now, hash } from './base.js';
import { one, many, update } from '../db/client.js';
import { DomainError, requireValue } from './errors.js';
export class AccountsService extends DomainBase {
  async register(input: EndpointInput<'register'>) {
    const user: User = {
      id: id(),
      displayName: input.displayName.trim(),
      handle: input.handle.replace(/\s/g, '').toLowerCase(),
    };
    const token = randomBytes(32).toString('base64url');
    try {
      await this.db.transaction(async (tx) => {
        await tx.query('INSERT INTO users(id,handle,data) VALUES($1,$2,$3)', [
          user.id,
          user.handle,
          JSON.stringify(user),
        ]);
        await tx.query('INSERT INTO user_sessions(token_hash,user_id) VALUES($1,$2)', [
          hash(token),
          user.id,
        ]);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new DomainError('HANDLE_TAKEN', '이미 사용 중인 아이디입니다.');
      throw error;
    }
    return { user, token };
  }
  async authenticate(token: string) {
    if (!token) return null;
    return one<User>(
      this.db.pool,
      'SELECT u.data FROM users u JOIN user_sessions s ON s.user_id=u.id WHERE s.token_hash=$1',
      [hash(token)],
    );
  }
  async resolveUsers(_actor: Actor, input: EndpointInput<'resolveUsers'>) {
    const handles = [...new Set(input.handles.map((h) => h.replace(/\s/g, '').toLowerCase()))];
    const users = await many<User>(this.db.pool, 'SELECT data FROM users WHERE handle=ANY($1)', [
      handles,
    ]);
    return { users, missingHandles: handles.filter((h) => !users.some((u) => u.handle === h)) };
  }
  async invitations(actor: Actor): Promise<Invitation[]> {
    const r = await this.db.pool.query(
      "SELECT m.study_id,m.created_at,u.data FROM study_members m JOIN users u ON m.inviter_user_id=u.id JOIN studies s ON s.id=m.study_id WHERE m.user_id=$1 AND m.state='invited' AND s.data->>'status'<>'ended'",
      [actor.userId],
    );
    return r.rows.map((row) => ({
      studyId: row.study_id as string,
      inviter: row.data as User,
      createdAt: (row.created_at as Date).toISOString(),
    }));
  }
  async createStudy(actor: Actor, input: EndpointInput<'createStudy'>) {
    return this.transaction(async (tx, events) =>
      this.receipt(tx, actor, input.commandId, 'studies.create', input, async () => {
        const creator = requireValue(
          await one<User>(tx, 'SELECT data FROM users WHERE id=$1', [actor.userId]),
        );
        const handles = [
          ...new Set(input.participantHandles.map((h) => h.replace(/\s/g, '').toLowerCase())),
        ];
        const users = await many<User>(tx, 'SELECT data FROM users WHERE handle=ANY($1)', [
          handles,
        ]);
        if (handles.some((h) => !users.some((u) => u.handle === h)))
          throw new DomainError('NOT_FOUND', '초대 대상 아이디를 확인해 주세요.', 404);
        const others = users.filter((u) => u.id !== creator.id);
        const study: Study = {
          id: id(),
          revision: 0,
          status: 'waiting',
          currentTopicId: null,
          transitionVersion: 0,
          members: [
            {
              userId: creator.id,
              handle: creator.handle,
              displayName: creator.displayName,
              state: 'joined',
            },
            ...others.map((u) => ({
              userId: u.id,
              handle: u.handle,
              displayName: u.displayName,
              state: 'invited' as const,
            })),
          ],
          createdAt: now(),
          endedAt: null,
        };
        await tx.query('INSERT INTO studies(id,data) VALUES($1,$2)', [
          study.id,
          JSON.stringify(study),
        ]);
        for (const member of study.members) {
          await tx.query(
            'INSERT INTO study_members(study_id,user_id,state,inviter_user_id) VALUES($1,$2,$3,$4)',
            [study.id, member.userId, member.state, creator.id],
          );
          if (member.state === 'invited')
            events.push({
              scope: 'user',
              id: member.userId,
              type: 'invitation.created',
              payload: { studyId: study.id, inviter: creator, createdAt: study.createdAt },
            });
        }
        return study;
      }),
    );
  }
  async joinStudy(actor: Actor, studyId: string, input: EndpointInput<'joinStudy'>) {
    await this.transaction(async (tx, events) =>
      this.receipt(tx, actor, input.commandId, `studies.join:${studyId}`, input, async () => {
        const study = await this.study(tx, studyId, true);
        const member = study.members.find((m) => m.userId === actor.userId);
        if (!member)
          throw new DomainError('NOT_MEMBER', '초대받은 스터디에만 참여할 수 있습니다.', 403);
        if (study.status === 'ended' && member.state !== 'joined')
          throw new DomainError('ACTION_NOT_READY', '종료된 스터디에는 새로 참여할 수 없습니다.');
        if (member.state !== 'joined') {
          member.state = 'joined';
          study.revision++;
          await tx.query(
            "UPDATE study_members SET state='joined' WHERE study_id=$1 AND user_id=$2",
            [studyId, actor.userId],
          );
          await update(tx, 'studies', studyId, study);
          await this.studyEvent(tx, events, study);
        }
        return { studyId };
      }),
    );
    return this.snapshot(actor, studyId);
  }
  async listExperiences(actor: Actor) {
    return many<Experience>(
      this.db.pool,
      "SELECT data FROM experiences WHERE owner_user_id=$1 ORDER BY data->>'updatedAt' DESC",
      [actor.userId],
    );
  }
  async saveExperience(actor: Actor, input: EndpointInput<'createExperience'>) {
    return this.transaction(async (tx) =>
      this.receipt(tx, actor, input.commandId, 'experiences.create', input, async () => {
        const draft = requireValue(
          await one<ExperienceDraft>(tx, 'SELECT data FROM experience_drafts WHERE id=$1', [
            input.draftId,
          ]),
        );
        if (draft.ownerUserId !== actor.userId)
          throw new DomainError('NOT_OWNER', '본인의 경험만 저장할 수 있습니다.', 403);
        const { draftId: _draftId, commandId: _commandId, ...fields } = input;
        const experience: Experience = {
          ...fields,
          id: id(),
          revision: 0,
          ownerUserId: actor.userId,
          updatedAt: now(),
        };
        await tx.query('INSERT INTO experiences(id,owner_user_id,data) VALUES($1,$2,$3)', [
          experience.id,
          actor.userId,
          JSON.stringify(experience),
        ]);
        return experience;
      }),
    );
  }
  async editExperience(
    actor: Actor,
    experienceId: string,
    input: EndpointInput<'updateExperience'>,
  ) {
    return this.transaction(async (tx) =>
      this.receipt(
        tx,
        actor,
        input.commandId,
        `experiences.edit:${experienceId}`,
        input,
        async () => {
          const prior = requireValue(
            await one<Experience>(tx, 'SELECT data FROM experiences WHERE id=$1 FOR UPDATE', [
              experienceId,
            ]),
          );
          if (prior.ownerUserId !== actor.userId)
            throw new DomainError('NOT_OWNER', '본인의 경험만 수정할 수 있습니다.', 403);
          const { commandId: _commandId, ...fields } = input;
          const result: Experience = {
            ...prior,
            ...fields,
            revision: prior.revision + 1,
            updatedAt: now(),
          };
          await update(tx, 'experiences', experienceId, result);
          return result;
        },
      ),
    );
  }
}
