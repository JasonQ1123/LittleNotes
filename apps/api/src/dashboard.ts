import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, CurrentUser } from './auth';
import { Database } from './database';
import { CATEGORIES, RATINGS, StatisticsQueryDto } from './dto';
import { recordInclude, RecordsService } from './records';
import { activeSpaceScope } from './space-access';

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
      where: { ...this.records.scope(user), status: { not: 'draft' } },
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
    // 30 天与 90 天按周分桶（周一为一周起点，最后一周截止到今天）；
    // 一年跨度按周会有 52 根柱子，仍按自然月分桶。
    const bucket: 'week' | 'month' = days <= 120 ? 'week' : 'month';
    const dayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const localDay = (date: Date) => {
      const parts = dayParts.formatToParts(date);
      const pick = (type: string) => Number(parts.find((p) => p.type === type)!.value);
      return Date.UTC(pick('year'), pick('month') - 1, pick('day'));
    };
    const mondayOf = (day: number) => {
      const weekday = new Date(day).getUTCDay(); // 0 = 周日
      return day - ((weekday + 6) % 7) * 86400_000;
    };
    const shortDate = (day: number) => {
      const date = new Date(day);
      return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
    };
    let trend: { label: string; count: number }[];
    if (bucket === 'week') {
      const firstWeek = mondayOf(localDay(new Date(since)));
      const lastWeek = mondayOf(localDay(new Date(now)));
      const weeks = Math.floor((lastWeek - firstWeek) / (7 * 86400_000)) + 1;
      trend = Array.from({ length: weeks }, (_, index) => ({
        label: shortDate(firstWeek + index * 7 * 86400_000),
        count: 0,
      }));
      for (const record of rows) {
        const index = Math.floor(
          (mondayOf(localDay(record.occurredAt)) - firstWeek) / (7 * 86400_000),
        );
        if (index >= 0 && index < weeks) trend[index].count++;
      }
    } else {
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
      trend = Array.from({ length: months }, (_, index) => {
        const label = new Date(Date.UTC(startYear, startMonth - 1 + index, 1))
          .toISOString()
          .slice(0, 7);
        return { label, count: rows.filter((r) => monthKey(r.occurredAt) === label).length };
      });
    }
    const members = user.spaceId
      ? await this.db.user.findMany({
          where: { space: activeSpaceScope(user) },
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
      bucket,
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
