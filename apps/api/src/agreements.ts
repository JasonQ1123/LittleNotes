import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, CurrentUser } from './auth';
import { Database } from './database';
import { AgreementDto, DueDateDto, ReviewDto } from './dto';
import { RecordsService, recordInclude } from './records';

@Injectable()
export class AgreementsService {
  constructor(
    private db: Database,
    private records: RecordsService,
  ) {}
  async list(user: Actor) {
    const records = await this.db.record.findMany({
      where: {
        ...this.records.scope(user),
        status: 'followup',
        agreements: { some: { status: 'active' } },
      },
      include: recordInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((r) => this.records.view(r, user));
  }
  async propose(user: Actor, recordId: string, dto: AgreementDto) {
    await this.db.atomic(async (tx) => {
      const record = await this.records.require(user, recordId, tx);
      this.records.shared(record);
      this.records.editable(record);
      const latest = record.agreements[0]?.version || 0;
      if (latest !== dto.baseVersion)
        throw new ConflictException('对方刚刚更新了解决方案，请刷新后再讨论');
      const members = record.space.members.map((m) => m.id);
      if (dto.actions.some((a) => a.assigneeId !== 'both' && !members.includes(a.assigneeId)))
        throw new BadRequestException('行动负责人必须是共同空间的成员');
      await tx.agreement.updateMany({
        where: { recordId, status: 'pending' },
        data: { status: 'superseded' },
      });
      await tx.agreement.create({
        data: {
          recordId,
          version: latest + 1,
          understanding: dto.understanding,
          criteria: dto.criteria,
          actionsJson: JSON.stringify(dto.actions),
          requestedDueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          proposedById: user.id,
        },
      });
      await tx.archiveVote.deleteMany({ where: { recordId } });
    });
    return this.records.get(user, recordId);
  }
  async confirm(user: Actor, id: string) {
    const recordId = await this.db.atomic(async (tx) => {
      const agreement = await tx.agreement.findUnique({ where: { id } });
      if (!agreement) throw new NotFoundException('约定不存在');
      const record = await this.records.require(user, agreement.recordId, tx);
      this.records.shared(record);
      this.records.editable(record);
      if (agreement.status === 'active') return record.id;
      if (agreement.status !== 'pending' || record.agreements[0].id !== id)
        throw new ConflictException('这个版本已被更新，请查看最新方案');
      if (record.space.members.length !== 2)
        throw new ConflictException('邀请对方加入后，才能共同确认约定');
      await tx.agreementConfirmation.upsert({
        where: { agreementId_userId: { agreementId: id, userId: user.id } },
        create: { agreementId: id, userId: user.id },
        update: {},
      });
      const count = await tx.agreementConfirmation.count({ where: { agreementId: id } });
      if (count === 2) {
        await tx.agreement.updateMany({
          where: { recordId: record.id, status: 'active' },
          data: { status: 'superseded' },
        });
        await tx.agreement.update({
          where: { id },
          data: { status: 'active', activatedAt: new Date() },
        });
        await tx.reviewCycle.create({
          data: {
            agreementId: id,
            number: 1,
            dueAt: agreement.requestedDueAt || new Date(Date.now() + 7 * 86400_000),
          },
        });
        await tx.record.update({ where: { id: record.id }, data: { status: 'followup' } });
      }
      return record.id;
    });
    return this.records.get(user, recordId);
  }
  async review(user: Actor, cycleId: string, dto: ReviewDto) {
    const recordId = await this.db.atomic(async (tx) => {
      const cycle = await tx.reviewCycle.findUnique({
        where: { id: cycleId },
        include: { agreement: true },
      });
      if (!cycle) throw new NotFoundException('回访不存在');
      const record = await this.records.require(user, cycle.agreement.recordId, tx);
      this.records.editable(record);
      if (cycle.agreement.status !== 'active')
        throw new ConflictException('请回访当前生效的约定，旧版本已经保留为历史');
      const latest = await tx.reviewCycle.findFirst({
        where: { agreementId: cycle.agreementId },
        orderBy: { number: 'desc' },
      });
      if (latest?.id !== cycleId) throw new ConflictException('这一轮回访已结束，请填写最新回访');
      await tx.review.upsert({
        where: { cycleId_userId: { cycleId, userId: user.id } },
        create: { cycleId, userId: user.id, ...dto },
        update: { ...dto },
      });
      return record.id;
    });
    return this.records.get(user, recordId);
  }
  async schedule(user: Actor, id: string, dto: DueDateDto) {
    const recordId = await this.db.atomic(async (tx) => {
      const agreement = await tx.agreement.findUnique({
        where: { id },
        include: { cycles: { orderBy: { number: 'desc' }, include: { reviews: true } } },
      });
      if (!agreement) throw new NotFoundException('约定不存在');
      const record = await this.records.require(user, agreement.recordId, tx);
      this.records.editable(record);
      if (agreement.status !== 'active')
        throw new ConflictException('只能为当前生效的约定安排回访');
      const latest = agreement.cycles[0];
      if (latest && latest.reviews.length < 2) {
        await tx.reviewCycle.update({
          where: { id: latest.id },
          data: { dueAt: new Date(dto.dueAt) },
        });
      } else {
        await tx.reviewCycle.create({
          data: { agreementId: id, number: (latest?.number || 0) + 1, dueAt: new Date(dto.dueAt) },
        });
      }
      return record.id;
    });
    return this.records.get(user, recordId);
  }
}

@ApiTags('Agreements')
@ApiCookieAuth()
@Controller()
export class AgreementsController {
  constructor(private service: AgreementsService) {}
  @Get('agreements') list(@CurrentUser() user: Actor) {
    return this.service.list(user);
  }
  @Post('records/:id/agreements') propose(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: AgreementDto,
  ) {
    return this.service.propose(user, id, dto);
  }
  @Post('agreements/:id/confirm') confirm(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.confirm(user, id);
  }
  @Post('agreements/:id/schedule') schedule(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: DueDateDto,
  ) {
    return this.service.schedule(user, id, dto);
  }
  @ApiTags('Reviews') @Post('reviews/:id') review(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.service.review(user, id, dto);
  }
}
