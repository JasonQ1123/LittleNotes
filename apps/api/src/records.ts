import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Actor, CurrentUser } from './auth';
import { Database } from './database';
import {
  CreateRecordDto,
  LinkDto,
  PerspectiveDto,
  ReconcileDto,
  RecordsQueryDto,
  UpdateRecordDto,
} from './dto';

const linkSelect = {
  id: true,
  title: true,
  status: true,
  occurredAt: true,
  authorId: true,
} as const;
export const recordInclude = Prisma.validator<Prisma.RecordInclude>()({
  space: { select: { name: true, members: { select: { id: true, nickname: true } } } },
  perspectives: true,
  agreements: {
    orderBy: { version: 'desc' },
    include: {
      confirmations: true,
      cycles: {
        orderBy: { number: 'desc' },
        include: { reviews: { orderBy: { createdAt: 'asc' } } },
      },
    },
  },
  reconciliations: true,
  archiveVotes: true,
  relatedTo: { include: { related: { select: linkSelect } } },
  relatedFrom: { include: { record: { select: linkSelect } } },
});
export type FullRecord = Prisma.RecordGetPayload<{ include: typeof recordInclude }>;

@Injectable()
export class RecordsService {
  constructor(public db: Database) {}
  scope(user: Actor): Prisma.RecordWhereInput {
    return {
      spaceId: user.spaceId || '',
      OR: [{ status: { not: 'draft' } }, { authorId: user.id }],
    };
  }
  async require(
    user: Actor,
    id: string,
    tx: Prisma.TransactionClient = this.db,
  ): Promise<FullRecord> {
    const record = await tx.record.findFirst({
      where: { id, ...this.scope(user) },
      include: recordInclude,
    });
    if (!record) throw new NotFoundException('这张纸条不存在，或你没有查看权限');
    return record;
  }
  editable(record: FullRecord) {
    if (record.status === 'archived')
      throw new ConflictException('这张纸条已经归档，内容已保留为历史记录');
  }
  shared(record: FullRecord) {
    if (record.status === 'draft') throw new ConflictException('请先把纸条分享到共同空间');
  }
  view(record: FullRecord, user: Actor) {
    const { tagsJson, perspectives, agreements, relatedTo, relatedFrom, ...base } = record;
    return {
      ...base,
      tags: JSON.parse(tagsJson) as string[],
      reconciled:
        record.space.members.length === 2 &&
        record.space.members.every((m) =>
          record.reconciliations.some((r) => r.userId === m.id && r.value),
        ),
      perspectives: perspectives
        .filter((p) => p.userId === user.id || p.publishedJson !== null)
        .map((p) => ({
          id: p.id,
          userId: p.userId,
          publishedAt: p.publishedAt,
          content: JSON.parse(p.userId === user.id ? p.draftJson : p.publishedJson!),
          ...(p.userId === user.id
            ? {
                revision: p.revision,
                hasUnpublishedChanges: p.draftJson !== p.publishedJson,
                publishedContent: p.publishedJson ? JSON.parse(p.publishedJson) : null,
              }
            : {}),
        })),
      agreements: agreements.map(({ actionsJson, ...agreement }) => ({
        ...agreement,
        actions: JSON.parse(actionsJson) as { text: string; assigneeId: string }[],
      })),
      related: [
        ...new Map(
          [...relatedTo.map((l) => l.related), ...relatedFrom.map((l) => l.record)]
            .filter((r) => r.status !== 'draft' || r.authorId === user.id)
            .map((r) => [r.id, r]),
        ).values(),
      ],
    };
  }
  async get(user: Actor, id: string) {
    return this.view(await this.require(user, id), user);
  }
  async list(user: Actor, query: RecordsQueryDto) {
    const where: Prisma.RecordWhereInput = {
      AND: [
        this.scope(user),
        {
          ...(query.q
            ? { OR: [{ title: { contains: query.q } }, { description: { contains: query.q } }] }
            : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.tag ? { tagsJson: { contains: JSON.stringify(query.tag) } } : {}),
        },
      ],
    };
    const [items, total] = await Promise.all([
      this.db.record.findMany({
        where,
        include: recordInclude,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 20,
        skip: ((query.page || 1) - 1) * 20,
      }),
      this.db.record.count({ where }),
    ]);
    return {
      items: items.map((r) => this.view(r, user)),
      total,
      page: query.page || 1,
      pageSize: 20,
    };
  }
  async create(user: Actor, dto: CreateRecordDto) {
    if (!user.spaceId) throw new ConflictException('请先创建或加入共同空间');
    const record = await this.db.record.create({
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
        tagsJson: JSON.stringify((dto.tags || []).map((t) => t.trim()).filter(Boolean)),
        spaceId: user.spaceId,
        authorId: user.id,
      },
      include: recordInclude,
    });
    return this.view(record, user);
  }
  async update(user: Actor, id: string, dto: UpdateRecordDto) {
    await this.db.atomic(async (tx) => {
      const record = await this.require(user, id, tx);
      this.editable(record);
      if (record.authorId !== user.id)
        throw new ForbiddenException('只能由记录者修改事件概况，你可以补充自己的视角');
      if (record.revision !== dto.revision)
        throw new ConflictException('记录已更新，请刷新后再保存');
      await tx.record.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          category: dto.category,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
          tagsJson: dto.tags
            ? JSON.stringify(dto.tags.map((t) => t.trim()).filter(Boolean))
            : undefined,
          revision: { increment: 1 },
        },
      });
    });
    return this.get(user, id);
  }
  async publish(user: Actor, id: string) {
    await this.db.atomic(async (tx) => {
      const record = await this.require(user, id, tx);
      if (record.authorId !== user.id) throw new ForbiddenException('只能发布自己的纸条');
      if (record.status === 'draft')
        await tx.record.update({
          where: { id },
          data: { status: 'review', revision: { increment: 1 } },
        });
    });
    return this.get(user, id);
  }
  async remove(user: Actor, id: string) {
    await this.db.atomic(async (tx) => {
      const record = await this.require(user, id, tx);
      if (record.status !== 'draft' || record.authorId !== user.id)
        throw new ForbiddenException('只能删除自己的私密草稿；已共享纸条可以共同归档');
      await tx.record.delete({ where: { id } });
    });
    return { ok: true };
  }
  async perspective(user: Actor, id: string, dto: PerspectiveDto) {
    await this.db.atomic(async (tx) => {
      const record = await this.require(user, id, tx);
      this.editable(record);
      if (dto.publish) this.shared(record);
      const current = record.perspectives.find((p) => p.userId === user.id);
      if ((current?.revision || 0) !== dto.revision)
        throw new ConflictException('你的视角已在其他页面更新，请刷新后再保存');
      const content = {
        facts: dto.facts,
        feelings: dto.feelings,
        causes: dto.causes,
        needs: dto.needs,
        adjustments: dto.adjustments,
      };
      if (dto.publish && !Object.values(content).some((v) => v.trim()))
        throw new BadRequestException('先写下一点你的想法，再分享给对方');
      const draftJson = JSON.stringify(content);
      const published = dto.publish ? { publishedJson: draftJson, publishedAt: new Date() } : {};
      await tx.perspective.upsert({
        where: { recordId_userId: { recordId: id, userId: user.id } },
        create: { recordId: id, userId: user.id, draftJson, ...published },
        update: { draftJson, revision: { increment: 1 }, ...published },
      });
    });
    return this.get(user, id);
  }
  async reconcile(user: Actor, id: string, dto: ReconcileDto) {
    await this.db.atomic(async (tx) => {
      const record = await this.require(user, id, tx);
      this.shared(record);
      this.editable(record);
      await tx.reconciliation.upsert({
        where: { recordId_userId: { recordId: id, userId: user.id } },
        create: { recordId: id, userId: user.id, value: dto.value },
        update: { value: dto.value },
      });
    });
    return this.get(user, id);
  }
  async archive(user: Actor, id: string) {
    await this.db.atomic(async (tx) => {
      const record = await this.require(user, id, tx);
      this.shared(record);
      if (record.status === 'archived') return;
      if (record.space.members.length !== 2)
        throw new ConflictException('邀请对方加入后，才能共同结束跟进');
      await tx.archiveVote.upsert({
        where: { recordId_userId: { recordId: id, userId: user.id } },
        create: { recordId: id, userId: user.id },
        update: {},
      });
      const count = await tx.archiveVote.count({ where: { recordId: id } });
      if (count === 2) await tx.record.update({ where: { id }, data: { status: 'archived' } });
    });
    return this.get(user, id);
  }
  async link(user: Actor, id: string, dto: LinkDto) {
    await this.db.atomic(async (tx) => {
      if (id === dto.relatedId) throw new BadRequestException('不能关联纸条自身');
      const record = await this.require(user, id, tx);
      this.shared(record);
      this.editable(record);
      const related = await this.require(user, dto.relatedId, tx);
      this.shared(related);
      const exists = await tx.recordLink.findUnique({
        where: { recordId_relatedId: { recordId: dto.relatedId, relatedId: id } },
      });
      if (!exists)
        await tx.recordLink.upsert({
          where: { recordId_relatedId: { recordId: id, relatedId: dto.relatedId } },
          create: { recordId: id, relatedId: dto.relatedId },
          update: {},
        });
    });
    return this.get(user, id);
  }
}

@ApiTags('Records')
@ApiCookieAuth()
@Controller('records')
export class RecordsController {
  constructor(private service: RecordsService) {}
  @Get() list(@CurrentUser() user: Actor, @Query() query: RecordsQueryDto) {
    return this.service.list(user, query);
  }
  @Post() create(@CurrentUser() user: Actor, @Body() dto: CreateRecordDto) {
    return this.service.create(user, dto);
  }
  @Get(':id') get(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.get(user, id);
  }
  @Patch(':id') update(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: UpdateRecordDto,
  ) {
    return this.service.update(user, id, dto);
  }
  @Post(':id/publish') publish(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.publish(user, id);
  }
  @Delete(':id') remove(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
  @Post(':id/perspective') perspective(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: PerspectiveDto,
  ) {
    return this.service.perspective(user, id, dto);
  }
  @Post(':id/reconcile') reconcile(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: ReconcileDto,
  ) {
    return this.service.reconcile(user, id, dto);
  }
  @Post(':id/archive') archive(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.archive(user, id);
  }
  @Post(':id/links') link(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: LinkDto,
  ) {
    return this.service.link(user, id, dto);
  }
}
