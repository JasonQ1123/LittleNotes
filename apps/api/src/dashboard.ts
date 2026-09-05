import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, CurrentUser } from './auth';
import { Database } from './database';
import { CATEGORIES, RATINGS, StatisticsQueryDto } from './dto';
import { recordInclude, RecordsService } from './records';

@Injectable()
export class DashboardService {
  constructor(
    private db: Database,
    private records: RecordsService,
  ) {}
  async home(user: Actor) {
    const rows = await this.db.record.findMany({
      where: this.records.scope(user),
      include: recordInclude,
      orderBy: { occurredAt: 'desc' },
    });
    const todos: { recordId: string; title: string; kind: string; label: string; dueAt?: Date }[] =
      [];
    for (const r of rows) {
      if (r.status === 'archived') continue;
      if (r.status === 'draft') {
        todos.push({ recordId: r.id, title: r.title, kind: 'draft', label: '继续写下这张纸条' });
        continue;
      }
      const mine = r.perspectives.find((p) => p.userId === user.id);
      if (!mine?.publishedJson || mine.draftJson !== mine.publishedJson)
        todos.push({
          recordId: r.id,
          title: r.title,
          kind: 'perspective',
          label: '补充并分享我的视角',
        });
      const pending = r.agreements.find((a) => a.status === 'pending');
      if (pending && !pending.confirmations.some((c) => c.userId === user.id))
        todos.push({ recordId: r.id, title: r.title, kind: 'confirm', label: '看看这份共同约定' });
      const cycle = r.agreements.find((a) => a.status === 'active')?.cycles[0];
      if (
        cycle &&
        cycle.dueAt.getTime() <= Date.now() &&
        !cycle.reviews.some((v) => v.userId === user.id)
      )
        todos.push({
          recordId: r.id,
          title: r.title,
          kind: 'review',
          label: '到时间了，回头看看',
          dueAt: cycle.dueAt,
        });
      if (r.archiveVotes.length > 0 && !r.archiveVotes.some((v) => v.userId === user.id))
        todos.push({
          recordId: r.id,
          title: r.title,
          kind: 'archive',
          label: '对方想与你一起结束跟进',
        });
    }
    const shared = rows.filter((r) => r.status !== 'draft');
    const order: Record<string, number> = {
      review: 0,
      confirm: 1,
      archive: 2,
      perspective: 3,
      draft: 4,
    };
    todos.sort((a, b) => order[a.kind] - order[b.kind]);
    return {
      todos,
      counts: {
        records: shared.length,
        activeAgreements: shared
          .filter((r) => r.status !== 'archived')
          .reduce((n, r) => n + r.agreements.filter((a) => a.status === 'active').length, 0),
        dueReviews: todos.filter((t) => t.kind === 'review').length,
        archived: shared.filter((r) => r.status === 'archived').length,
      },
      recent: rows.slice(0, 4).map((r) => this.records.view(r, user)),
    };
  }
  async statistics(user: Actor, days: number) {
    const all = await this.db.record.findMany({
      where: { spaceId: user.spaceId || '', status: { not: 'draft' } },
      include: recordInclude,
      orderBy: { occurredAt: 'desc' },
    });
    const now = Date.now();
    const since = now - days * 86400_000;
    const rows = all.filter(
      (r) => r.occurredAt.getTime() >= since && r.occurredAt.getTime() <= now,
    );
    const categories = CATEGORIES.map((name) => ({
      name,
      count: rows.filter((r) => r.category === name).length,
    }));
    const monthFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
    });
    const monthKey = (date: Date) => {
      const parts = monthFormatter.formatToParts(date);
      return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
    };
    const [startYear, startMonth] = monthKey(new Date(since)).split('-').map(Number);
    const [endYear, endMonth] = monthKey(new Date(now)).split('-').map(Number);
    const months = (endYear - startYear) * 12 + endMonth - startMonth + 1;
    const trend = Array.from({ length: months }, (_, index) => {
      const label = new Date(Date.UTC(startYear, startMonth - 1 + index, 1))
        .toISOString()
        .slice(0, 7);
      return { label, count: rows.filter((r) => monthKey(r.occurredAt) === label).length };
    });
    const members = user.spaceId
      ? await this.db.user.findMany({
          where: { spaceId: user.spaceId },
          select: { id: true, nickname: true },
        })
      : [];
    const reviews = all
      .flatMap((r) => r.agreements.flatMap((a) => a.cycles.flatMap((c) => c.reviews)))
      .filter((r) => r.updatedAt.getTime() >= since);
    const ratings = members.map((member) => ({
      ...member,
      total: reviews.filter((r) => r.userId === member.id).length,
      values: RATINGS.map((name) => ({
        name,
        count: reviews.filter((r) => r.userId === member.id && r.rating === name).length,
      })),
    }));
    // Only explicit links form recurring themes; category overlap is not a recurrence signal.
    const parents = new Map(all.map((r) => [r.id, r.id]));
    const root = (id: string): string => {
      const parent = parents.get(id)!;
      if (parent !== id) parents.set(id, root(parent));
      return parents.get(id)!;
    };
    for (const r of all)
      for (const link of r.relatedTo)
        if (parents.has(link.relatedId)) parents.set(root(r.id), root(link.relatedId));
    const groups = new Map<string, typeof all>();
    for (const r of all) {
      const key = root(r.id);
      groups.set(key, [...(groups.get(key) || []), r]);
    }
    const recurring = [...groups.values()]
      .filter(
        (group) =>
          group.length > 1 &&
          group.some((r) => r.occurredAt.getTime() >= since && r.occurredAt.getTime() <= now),
      )
      .map((group) => ({
        title: group[0].title,
        count: group.length,
        records: group.map((r) => ({ id: r.id, title: r.title, occurredAt: r.occurredAt })),
      }))
      .sort((a, b) => b.count - a.count);
    return {
      days,
      total: rows.length,
      archived: rows.filter((r) => r.status === 'archived').length,
      categories,
      trend,
      ratings,
      recurring,
    };
  }
}

@ApiTags('Dashboard')
@ApiCookieAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}
  @Get() home(@CurrentUser() user: Actor) {
    return this.service.home(user);
  }
  @Get('statistics') statistics(@CurrentUser() user: Actor, @Query() query: StatisticsQueryDto) {
    return this.service.statistics(user, query.days);
  }
}
