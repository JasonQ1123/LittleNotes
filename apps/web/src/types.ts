export interface User {
  requiresEmailBinding: boolean;
  maskedEmail: string | null;
  id: string;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  spaceId: string | null;
}
export interface Member {
  id: string;
  nickname: string;
  avatarUrl: string | null;
}
export interface Space {
  lifecycleVersion: number;
  id: string;
  name: string;
  members: Member[];
  invitations: { id: string; expiresAt: string }[];
}
export interface RestoreRequest {
  id: string;
  requestedById: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired' | 'invalidated';
  createdAt: string;
  expiresAt: string;
}
export interface ClosedSpace {
  id: string;
  name: string;
  lifecycleVersion: number;
  closedAt: string;
  purgeAt: string;
  members: Member[];
  canRestore: boolean;
  restoreRequest: RestoreRequest | null;
}
export interface ClosedSpaceList {
  items: ClosedSpace[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PerspectiveContent {
  facts: string;
  feelings: string;
  causes: string;
  needs: string;
  adjustments: string;
}
export interface Perspective {
  id: string;
  userId: string;
  publishedAt: string | null;
  content: PerspectiveContent;
  revision?: number;
  hasUnpublishedChanges?: boolean;
  publishedContent?: PerspectiveContent | null;
}
export interface Review {
  id: string;
  userId: string;
  rating: string;
  achieved: string;
  example: string;
  remaining: string;
  adjustments: string;
  createdAt: string;
  updatedAt: string;
}
export interface ReviewCycle {
  id: string;
  number: number;
  dueAt: string;
  reviews: Review[];
}
export interface Agreement {
  id: string;
  version: number;
  status: 'pending' | 'active' | 'superseded';
  understanding: string;
  criteria: string;
  actions: { text: string; assigneeId: string }[];
  proposedById: string;
  requestedDueAt: string | null;
  activatedAt: string | null;
  confirmations: { userId: string }[];
  cycles: ReviewCycle[];
  createdAt: string;
}
export interface Note {
  id: string;
  authorId: string;
  spaceId: string;
  title: string;
  description: string;
  occurredAt: string;
  category: string;
  tags: string[];
  status: 'draft' | 'review' | 'followup' | 'archived';
  revision: number;
  createdAt: string;
  updatedAt: string;
  space: { name: string; members: Member[] };
  perspectives: Perspective[];
  agreements: Agreement[];
  reconciliations: { userId: string; value: boolean }[];
  reconciled: boolean;
  archiveVotes: { userId: string }[];
  related: { id: string; title: string; occurredAt: string; status: string }[];
}
export interface NoteList {
  items: Note[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Todo {
  recordId: string;
  title: string;
  kind: string;
  label: string;
  dueAt?: string;
}
export interface Dashboard {
  todos: Todo[];
  counts: { records: number; activeAgreements: number; dueReviews: number; archived: number };
  recent: Note[];
}
export interface Statistics {
  days: number;
  total: number;
  archived: number;
  categories: { name: string; count: number }[];
  trend: { label: string; count: number }[];
  ratings: {
    id: string;
    nickname: string;
    total: number;
    values: { name: string; count: number }[];
  }[];
  recurring: {
    title: string;
    count: number;
    records: { id: string; title: string; occurredAt: string }[];
  }[];
}
export const categories = [
  '沟通方式',
  '陪伴时间',
  '家务分工',
  '金钱消费',
  '边界隐私',
  '家庭朋友',
  '承诺计划',
  '其他',
];
export const ratings = ['明显改善', '部分改善', '没有改善', '变差', '暂时无法判断'];
export const statusLabels: Record<Note['status'], string> = {
  draft: '私密草稿',
  review: '复盘中',
  followup: '跟进中',
  archived: '已归档',
};
export const perspectiveFields: {
  key: keyof PerspectiveContent;
  label: string;
  placeholder: string;
}[] = [
  {
    key: 'facts',
    label: '我看到的事实',
    placeholder: '尽量描述具体发生的事，比如当时说了什么、做了什么。',
  },
  { key: 'feelings', label: '我的感受', placeholder: '当时我感到委屈、失落，还是担心？' },
  {
    key: 'causes',
    label: '我认为的原因',
    placeholder: '这件事为什么会触动我？之前是否发生过类似的情况？',
  },
  {
    key: 'needs',
    label: '我当时需要什么',
    placeholder: '我希望被理解的是什么？希望对方具体怎么做？',
  },
  { key: 'adjustments', label: '我可以调整什么', placeholder: '下次，我愿意尝试的一点小改变。' },
];
export const emptyPerspective = (): PerspectiveContent => ({
  facts: '',
  feelings: '',
  causes: '',
  needs: '',
  adjustments: '',
});
export function dateLabel(value: string, full = false) {
  return new Date(value).toLocaleDateString(
    'zh-CN',
    full ? { year: 'numeric', month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric' },
  );
}
export function inputDate(value: string | Date = new Date()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
