import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, ApiError, setApiSpaceContext } from './api';
import type { User, Space } from './types';

export const useSession = defineStore('session', () => {
  const user = ref<User | null>(null);
  const space = ref<Space | null>(null);
  const spaceKey = ref('');
  const syncRevision = ref(0);
  let loaded = false;
  let generation = 0;
  let refreshing: Promise<void> | undefined;
  function refresh(fresh = false): Promise<void> {
    // A successful mutation must supersede lookups started before that mutation.
    if (fresh) {
      generation++;
      refreshing = undefined;
    }
    if (refreshing) return refreshing;
    const task = refreshNow(generation);
    refreshing = task;
    void task
      .finally(() => {
        if (refreshing === task) refreshing = undefined;
      })
      .catch(() => undefined);
    return task;
  }
  async function refreshNow(startGeneration: number) {
    const previousUser = user.value?.id;
    const previousSpace = space.value;
    try {
      const nextUser = await api<User>('/auth/me');
      const nextSpace = nextUser.requiresEmailBinding
        ? null
        : await api<Space | null>('/spaces/current');
      if (startGeneration !== generation) return;
      user.value = { ...nextUser, spaceId: nextSpace?.id || null };
      space.value = nextSpace;
    } catch (error) {
      if (startGeneration !== generation) return;
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (user.value) {
        window.dispatchEvent(new Event('session-expired'));
        if (startGeneration !== generation) return;
      }
      user.value = null;
      space.value = null;
    }
    const nextKey = setApiSpaceContext(space.value, user.value?.id);
    const changed = loaded && previousUser === user.value?.id && spaceKey.value !== nextKey;
    spaceKey.value = nextKey;
    syncRevision.value++;
    loaded = true;
    if (changed)
      window.dispatchEvent(
        new CustomEvent('space-updated', {
          detail: { closed: !!previousSpace && !space.value },
        }),
      );
  }
  async function ensure() {
    if (!loaded) await refresh();
  }
  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    expire();
    loaded = true;
  }
  function expire() {
    generation++;
    refreshing = undefined;
    user.value = null;
    space.value = null;
    loaded = false;
    spaceKey.value = setApiSpaceContext(null);
  }
  return { user, space, spaceKey, syncRevision, refresh, ensure, logout, expire };
});
