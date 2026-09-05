import { ref } from 'vue';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError('暂时无法连接小纸条，请检查服务是否正在运行', 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(data?.message || '暂时没有完成，请稍后重试', response.status);
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
