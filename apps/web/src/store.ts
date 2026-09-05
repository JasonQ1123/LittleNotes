import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, ApiError } from './api';
import type { User, Space } from './types';

export const useSession = defineStore('session', () => {
  const user = ref<User | null>(null);
  const space = ref<Space | null>(null);
  let loaded = false;
  async function refresh() {
    try {
      user.value = await api<User>('/auth/me');
      space.value = await api<Space | null>('/spaces/current');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      user.value = null;
      space.value = null;
    }
    loaded = true;
  }
  async function ensure() {
    if (!loaded) await refresh();
  }
  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    user.value = null;
    space.value = null;
    loaded = true;
  }
  function expire() {
    user.value = null;
    space.value = null;
    loaded = false;
  }
  return { user, space, refresh, ensure, logout, expire };
});
