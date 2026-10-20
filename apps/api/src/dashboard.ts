import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
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
  async statistics(user: Actor, query: StatisticsQueryDto) {
    const all = await this.db.record.findMany({
      where: { ...this.records.scope(user), status: { not: 'draft' } },
      include: recordInclude,
      orderBy: { occurredAt: 'desc' },
    });
    const now = Date.now();
    const dayMs = 86400_000;
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
    const isoDay = (day: number) => new Date(day).toISOString().slice(0, 10);
    const mondayOf = (day: number) => {
      const weekday = new Date(day).getUTCDay(); // 0 = 周日
      return day - ((weekday + 6) % 7) * dayMs;
    };
    const shortDate = (day: number) => {
      const date = new Date(day);
      return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    };

    // 自定义区间按本地日切（Asia/Shanghai 固定 UTC+8），预设区间沿用「今天往回数」。
    let since: number;
    let until: number;
    let spanDays: number;
    let bucket: 'day' | 'week' | 'month' | 'quarter';
    if (query.from || query.to) {
      if (!query.from || !query.to)
        throw new BadRequestException('自定义统计需要同时提供开始与结束日期');
      const startDay = localDay(new Date(`${query.from}T00:00:00+08:00`));
      const endDay = localDay(new Date(`${query.to}T00:00:00+08:00`));
      if (!Number.isFinite(startDay) || !Number.isFinite(endDay))
        throw new BadRequestException('日期格式应为 YYYY-MM-DD');
      if (startDay > endDay) throw new BadRequestException('开始日期不能晚于结束日期');
      spanDays = Math.round((endDay - startDay) / dayMs) + 1;
      if (spanDays > 3650) throw new BadRequestException('统计范围最多 10 年');
      since = startDay - 8 * 3_600_000;
      until = endDay + dayMs - 1 - 8 * 3_600_000;
      // 跨度越长，柱子越粗：天 → 周 → 月 → 季度，避免几千根柱子。
      bucket =
        spanDays <= 14 ? 'day' : spanDays <= 120 ? 'week' : spanDays <= 730 ? 'month' : 'quarter';
    } else {
      const days = query.days ?? 90;
      spanDays = days;
      since = now - days * dayMs;
      until = now;
      bucket = days <= 120 ? 'week' : 'month';
    }

    const rows = all.filter(
      (r) => r.occurredAt.getTime() >= since && r.occurredAt.getTime() <= until,
    );
    const categories = CATEGORIES.map((name) => ({
      name,
      count: rows.filter((r) => r.category === name).length,
    }));

    const startDay = localDay(new Date(since));
    const endDay = localDay(new Date(until));
    const monthKey = (day: number) => {
      const date = new Date(day);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    const shortMonth = (key: string) => `${key.slice(2, 4)}/${key.slice(5, 7)}`;
    const quarterOf = (day: number) => {
      const date = new Date(day);
      return `${String(date.getUTCFullYear()).slice(2)} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    };

    let trend: { label: string; count: number }[];
    if (bucket === 'day') {
      const days = Math.round((endDay - startDay) / dayMs) + 1;
      trend = Array.from({ length: days }, (_, index) => ({
        label: shortDate(startDay + index * dayMs),
        count: 0,
      }));
      for (const record of rows) {
        const index = Math.round((localDay(record.occurredAt) - startDay) / dayMs);
        if (index >= 0 && index < days) trend[index].count++;
      }
    } else if (bucket === 'week') {
      const firstWeek = mondayOf(startDay);
      const lastWeek = mondayOf(endDay);
      const weeks = Math.floor((lastWeek - firstWeek) / (7 * dayMs)) + 1;
      trend = Array.from({ length: weeks }, (_, index) => ({
        label: shortDate(firstWeek + index * 7 * dayMs),
        count: 0,
      }));
      for (const record of rows) {
        const index = Math.floor((mondayOf(localDay(record.occurredAt)) - firstWeek) / (7 * dayMs));
        if (index >= 0 && index < weeks) trend[index].count++;
      }
    } else if (bucket === 'month') {
      const months: string[] = [];
      const cursor = new Date(startDay);
      let year = cursor.getUTCFullYear();
      let month = cursor.getUTCMonth();
      while (Date.UTC(year, month, 1) <= endDay) {
        months.push(`${year}-${String(month + 1).padStart(2, '0')}`);
        month += 1;
        if (month > 11) {
          month = 0;
          year += 1;
        }
      }
      const counts = new Map(months.map((key) => [key, 0]));
      for (const record of rows) {
        const key = monthKey(localDay(record.occurredAt));
        if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
      }
      trend = months.map((key) => ({ label: shortMonth(key), count: counts.get(key)! }));
    } else {
      const quarters: string[] = [];
      const cursor = new Date(startDay);
      let year = cursor.getUTCFullYear();
      let quarter = Math.floor(cursor.getUTCMonth() / 3);
      while (Date.UTC(year, quarter * 3, 1) <= endDay) {
        quarters.push(`${String(year).slice(2)} Q${quarter + 1}`);
        quarter += 1;
        if (quarter > 3) {
          quarter = 0;
          year += 1;
        }
      }
      const counts = new Map(quarters.map((key) => [key, 0]));
      for (const record of rows) {
        const key = quarterOf(localDay(record.occurredAt));
        if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
      }
      trend = quarters.map((key) => ({ label: key, count: counts.get(key)! }));
    }
    const members = user.spaceId
      ? await this.db.user.findMany({
          where: { space: activeSpaceScope(user) },
          select: { id: true, nickname: true },
        })
      : [];
    const reviews = all
      .flatMap((r) => r.agreements.flatMap((a) => a.cycles.flatMap((c) => c.reviews)))
      .filter((r) => r.updatedAt.getTime() >= since && r.updatedAt.getTime() <= until);
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
          group.some((r) => r.occurredAt.getTime() >= since && r.occurredAt.getTime() <= until),
      )
      .map((group) => ({
        title: group[0].title,
        count: group.length,
        records: group.map((r) => ({ id: r.id, title: r.title, occurredAt: r.occurredAt })),
      }))
      .sort((a, b) => b.count - a.count);
    return {
      days: spanDays,
      bucket,
      range: { from: isoDay(startDay), to: isoDay(endDay), days: spanDays },
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
    return this.service.statistics(user, query);
  }
}
