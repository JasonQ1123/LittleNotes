<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import BrandMark from '../components/BrandMark.vue';
import { api, useTask } from '../api';
import { useSession } from '../store';
import { isNewPasswordValid, NEW_PASSWORD_HINT, NEW_PASSWORD_PATTERN } from '../password';
import EmailVerification from '../components/EmailVerification.vue';
import { safeRedirect } from '../router';
const verification = ref({ email: '', challengeId: '', code: '' });
const register = ref(false);
const username = ref('');
const password = ref('');
const showPassword = ref(false);
const nickname = ref('');
const { busy, run } = useTask();
const session = useSession();
const route = useRoute();
const router = useRouter();
watch(register, () => {
  showPassword.value = false;
});
async function submit() {
  await run(async () => {
    if (register.value && !isNewPasswordValid(password.value))
      throw new Error(`密码需为 ${NEW_PASSWORD_HINT}`);
    await api(`/auth/${register.value ? 'register' : 'login'}`, {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value,
        ...(register.value ? { nickname: nickname.value, ...verification.value } : {}),
      },
    });
    await session.refresh();
    const next = safeRedirect(route.query.redirect);
    await router.replace(next);
  });
}
</script>
<template>
  <main id="main-content" class="auth-page">
    <section class="auth-story">
      <div class="brand">
        <BrandMark /><span>小纸条<small>把彼此放在心上</small></span>
      </div>
      <div class="auth-story-body">
        <h1>有些话，写下来。<br />有些约定，<span>一起记得。</span></h1>
        <p>收藏每一次认真沟通，<br />让和好之后的小改变，有迹可循。</p>
        <div class="auth-paper-board" aria-hidden="true">
          <div class="paper paper-one">
            <span class="paper-tape"></span><AppIcon name="heart" :size="27" />
            <p>不是每一次都很完美，<br />但我们愿意一起变好。</p>
            <small>给我们的一张小纸条</small>
          </div>
          <div class="paper paper-two">
            <AppIcon name="leaf" :size="32" /><span>慢慢来，也没关系。</span>
          </div>
        </div>
      </div>
      <div class="auth-caption"><AppIcon name="lock" :size="15" />只属于你们两个人的共同空间</div>
    </section>
    <section class="auth-form-wrap">
      <form class="auth-form" @submit.prevent="submit">
        <span class="eyebrow">一段故事，从这里继续</span>
        <h2>{{ register ? '认识一下，新的你' : '欢迎回来' }}<span class="hand-dot">.</span></h2>
        <p>
          {{
            register ? '建立一个账号，和重要的人一起慢慢记录。' : '留一点时间，给自己，也给彼此。'
          }}
        </p>
        <div class="segmented auth-tabs">
          <button type="button" :class="{ selected: !register }" @click="register = false">
            登录</button
          ><button type="button" :class="{ selected: register }" @click="register = true">
            注册账号
          </button>
        </div>
        <div v-if="route.query.connection" class="notice warm">
          暂时没有连接上服务，连接恢复后可以重新登录。
        </div>
        <div v-if="route.query.passwordChanged === '1'" class="notice" role="status">
          密码已修改，所有设备已退出登录。请使用新密码重新登录。
        </div>
        <div v-if="route.query.emailChanged === '1'" class="notice" role="status">
          邮箱已更换，所有设备已退出登录。请使用用户名和密码重新登录。
        </div>
        <div v-if="route.query.redirect" class="notice">登录后，我们会带你继续打开这份小纸条。</div>
        <label v-if="register" class="field"
          >怎么称呼你<input
            v-model="nickname"
            autocomplete="nickname"
            maxlength="30"
            required
            placeholder="对方熟悉的那个昵称" /></label
        ><label class="field"
          >用户名<input
            v-model="username"
            autocomplete="username"
            minlength="3"
            maxlength="32"
            pattern="[a-zA-Z0-9_]{3,32}"
            required
            placeholder="3–32 位字母、数字或下划线"
        /></label>
        <div class="field">
          <label for="auth-password">密码</label>
          <div class="password-input">
            <input
              id="auth-password"
              v-model="password"
              :autocomplete="register ? 'new-password' : 'current-password'"
              :type="showPassword ? 'text' : 'password'"
              minlength="8"
              :maxlength="register ? 32 : 128"
              :pattern="register ? NEW_PASSWORD_PATTERN : undefined"
              :title="register ? NEW_PASSWORD_HINT : undefined"
              :aria-describedby="register ? 'auth-password-hint' : undefined"
              required
              :placeholder="register ? '8–32 位英文字母与数字组合' : '请输入密码'"
            />
            <button
              type="button"
              class="icon-button password-toggle"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              aria-controls="auth-password"
              @click="showPassword = !showPassword"
            >
              <AppIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="18" />
            </button>
          </div>
          <small v-if="register" id="auth-password-hint">{{ NEW_PASSWORD_HINT }}</small>
        </div>
        <EmailVerification
          v-if="register"
          v-model="verification"
          endpoint="/auth/register/code"
          :disabled="busy"
        />
        <button
          class="btn primary full"
          :disabled="busy || (register && !verification.challengeId)"
        >
          {{ busy ? '请稍等…' : register ? '开启我们的小故事' : '回到小纸条'
          }}<AppIcon name="arrow" :size="18" />
        </button>
        <RouterLink v-if="!register" class="recovery-link" to="/forgot-password"
          >忘记密码？</RouterLink
        >
        <p class="auth-footnote"><AppIcon name="shield" :size="16" />私密草稿由你决定何时分享</p>
      </form>
    </section>
  </main>
</template>
