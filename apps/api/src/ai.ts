import {
  Controller,
  ForbiddenException,
  Injectable,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, CurrentUser } from './auth';
import { recordInclude, RecordsService } from './records';

export type SharedAiRecord = {
  id: string;
  title: string;
  description: string;
  category: string;
  perspectives: { userId: string; content: Record<string, string> }[];
  agreements: {
    understanding: string;
    actions: { text: string; assigneeId: string }[];
    criteria: string;
  }[];
  reviews: { userId: string; rating: string; example: string; remaining: string }[];
};
export type SummarySuggestion = {
  summary: string;
  suggestedCategory: string;
  proposedActions: string[];
};
export type RelatedSuggestion = { recordId: string; reason: string };
export interface AiProvider {
  summarizeRecord(record: SharedAiRecord): Promise<SummarySuggestion>;
  suggestRelatedRecords(
    record: SharedAiRecord,
    history: SharedAiRecord[],
  ): Promise<RelatedSuggestion[]>;
}

@Injectable()
export class AiService {
  // Register a real adapter here only when the feature is explicitly enabled later.
  private provider: AiProvider | undefined;
  constructor(private records: RecordsService) {}
  private project(record: Awaited<ReturnType<RecordsService['require']>>): SharedAiRecord {
    return {
      id: record.id,
      title: record.title,
      description: record.description,
      category: record.category,
      perspectives: record.perspectives
        .filter((p) => p.publishedJson)
        .map((p) => ({ userId: p.userId, content: JSON.parse(p.publishedJson!) })),
      agreements: record.agreements
        .filter((a) => a.activatedAt)
        .map((a) => ({
          understanding: a.understanding,
          actions: JSON.parse(a.actionsJson),
          criteria: a.criteria,
        })),
      reviews: record.agreements.flatMap((a) =>
        a.cycles.flatMap((c) =>
          c.reviews.map((r) => ({
            userId: r.userId,
            rating: r.rating,
            example: r.example,
            remaining: r.remaining,
          })),
        ),
      ),
    };
  }
  async run(user: Actor, id: string, kind: 'summary' | 'related') {
    const record = await this.records.require(user, id);
    this.records.shared(record);
    if (process.env.AI_ENABLED !== 'true')
      throw new ForbiddenException({ code: 'AI_DISABLED', message: 'AI 功能暂未开放' });
    if (!this.provider)
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message: 'AI 服务尚未配置',
      });
    if (kind === 'summary') return this.provider.summarizeRecord(this.project(record));
    const history = await this.records.db.record.findMany({
      where: { spaceId: record.spaceId, status: { not: 'draft' }, id: { not: id } },
      include: recordInclude,
    });
    return this.provider.suggestRelatedRecords(
      this.project(record),
      history.map((r) => this.project(r)),
    );
  }
}

@ApiTags('AI')
@ApiCookieAuth()
@Controller('ai/records')
export class AiController {
  constructor(private service: AiService) {}
  @Post(':id/summarize') summarize(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.run(user, id, 'summary');
  }
  @Post(':id/related') related(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.run(user, id, 'related');
  }
}
