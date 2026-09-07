import { ref } from 'vue';

let spaceContext: { id: string; lifecycleVersion: number } | null = null;
let contextKey = '';
let contextVersion = 0;
export function setApiSpaceContext(space: typeof spaceContext, userId?: string) {
  const next = (userId || '') + ':' + (space ? space.id + ':' + space.lifecycleVersion : '');
  if (next !== contextKey) {
    contextKey = next;
    contextVersion++;
  }
  spaceContext = space;
  return next;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const scoped =
    /^\/(records|agreements|reviews|dashboard)(\/|$)/.test(path) ||
    path === '/spaces/invitations' ||
    (path.startsWith('/spaces/invitations/') && path !== '/spaces/invitations/accept');
  const version = contextVersion;
  const spaceHeaders: Record<string, string> =
    scoped && spaceContext && options.method && options.method !== 'GET'
      ? { 'X-Space-Id': spaceContext.id, 'X-Space-Version': String(spaceContext.lifecycleVersion) }
      : {};
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: {
        ...spaceHeaders,
        ...(options.body !== undefined && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body:
        options.body instanceof FormData
          ? options.body
          : options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined,
    });
  } catch {
    throw new ApiError('暂时无法连接小纸条，请检查服务是否正在运行', 0);
  }
  const data = await response.json().catch(() => null);
  if (scoped && version !== contextVersion)
    throw new ApiError('空间已变化，旧页面内容已清除', 409, undefined, 'SPACE_CHANGED');
  if (!response.ok) {
    if (
      (scoped && response.status === 404) ||
      (response.status === 409 && /^(SPACE_|RESTORE_)/.test(data?.code || ''))
    )
      window.dispatchEvent(new Event('space-state-changed'));
    if (data?.code === 'EMAIL_BINDING_REQUIRED')
      window.dispatchEvent(new Event('email-binding-required'));
    if (
      response.status === 401 &&
      (!path.startsWith('/auth/') ||
        path === '/auth/password/change' ||
        path.startsWith('/auth/email'))
    )
      window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(
      data?.message || '暂时没有完成，请稍后重试',
      response.status,
      data?.retryAfter,
      data?.code,
    );
  }
  return data as T;
}

export const toast = ref<{ message: string; error: boolean } | null>(null);
let timer: ReturnType<typeof setTimeout>;
export function notify(message: string, error = false) {
  toast.value = { message, error };
  clearTimeout(timer);
  timer = setTimeout(
    () => {
      toast.value = null;
    },
    error ? 7000 : 3500,
  );
}
export function useTask() {
  const busy = ref(false);
  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    if (busy.value) return;
    busy.value = true;
    try {
      const result = await fn();
      if (success) notify(success);
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : '操作没有完成，请重试', true);
    } finally {
      busy.value = false;
    }
  }
  return { busy, run };
}
