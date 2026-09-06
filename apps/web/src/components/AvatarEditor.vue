<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import AppIcon from './AppIcon.vue';
const props = defineProps<{ file: File; busy: boolean; saveError?: string }>();
const emit = defineEmits<{ save: [blob: Blob]; cancel: []; choose: [] }>();
const dialog = ref<HTMLDialogElement>();
const canvas = ref<HTMLCanvasElement>();
const bitmap = shallowRef<ImageBitmap>();
const zoom = ref(1);
const x = ref(0);
const y = ref(0);
const loading = ref(true);
const exporting = ref(false);
const error = ref('');
const locked = computed(() => props.busy || exporting.value);
let generation = 0;
let drag: { id: number; x: number; y: number } | null = null;

function size() {
  if (!bitmap.value) return { width: 256, height: 256 };
  const scale = Math.max(256 / bitmap.value.width, 256 / bitmap.value.height) * zoom.value;
  return { width: bitmap.value.width * scale, height: bitmap.value.height * scale };
}
function draw() {
  const context = canvas.value?.getContext('2d');
  if (!context || !bitmap.value) return;
  const { width, height } = size();
  x.value = Math.max(-(width - 256) / 2, Math.min((width - 256) / 2, x.value));
  y.value = Math.max(-(height - 256) / 2, Math.min((height - 256) / 2, y.value));
  context.clearRect(0, 0, 256, 256);
  context.drawImage(
    bitmap.value,
    (256 - width) / 2 + x.value,
    (256 - height) / 2 + y.value,
    width,
    height,
  );
}

// Inspect container chunks so animated PNG/WebP files are rejected before cropping.
function supported(bytes: Uint8Array) {
  const ascii = (offset: number, count: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + count));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = ascii(offset, 4);
      if (type === 'ANIM' || type === 'ANMF') return false;
      const length = view.getUint32(offset + 4, true);
      offset += 8 + length + (length % 2);
    }
    return true;
  }
  if (bytes[0] === 137 && ascii(1, 3) === 'PNG') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      if (ascii(offset + 4, 4) === 'acTL') return false;
      offset += 12 + view.getUint32(offset);
    }
    return true;
  }
  return false;
}
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = '';
  bitmap.value?.close();
  bitmap.value = undefined;
  let decoded: ImageBitmap | undefined;
  try {
    if (props.file.size > 5 * 1024 * 1024)
      throw new Error('图片不能超过 5 MB，请选择一张小一点的图片');
    if (!supported(new Uint8Array(await props.file.arrayBuffer())))
      throw new Error('请选择静态 JPG、PNG 或 WebP 图片');
    decoded = await createImageBitmap(props.file, { imageOrientation: 'from-image' });
    if (current !== generation) return;
    if (decoded.width * decoded.height > 24_000_000)
      throw new Error('图片分辨率太高，请选择不超过 2400 万像素的图片');
    bitmap.value = decoded;
    decoded = undefined;
    zoom.value = 1;
    x.value = y.value = 0;
    loading.value = false;
    await nextTick();
    draw();
  } catch (reason) {
    if (current === generation) {
      const message = reason instanceof Error ? reason.message : '';
      error.value = /^(图片|请选择)/.test(message) ? message : '图片无法读取，请重新选择';
    }
  } finally {
    decoded?.close();
    if (current === generation) loading.value = false;
  }
}
function changeZoom(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  x.value *= value / zoom.value;
  y.value *= value / zoom.value;
  zoom.value = value;
  draw();
}
function down(event: PointerEvent) {
  if (locked.value || !bitmap.value || drag) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.value?.setPointerCapture(event.pointerId);
  canvas.value?.focus({ preventScroll: true });
}
function move(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId || locked.value) return;
  const scale = 256 / (canvas.value?.getBoundingClientRect().width || 256);
  x.value += (event.clientX - drag.x) * scale;
  y.value += (event.clientY - drag.y) * scale;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  draw();
}
function end(event: PointerEvent) {
  if (drag?.id === event.pointerId) drag = null;
}
function key(event: KeyboardEvent) {
  if (locked.value || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
    return;
  event.preventDefault();
  const step = event.shiftKey ? 20 : 5;
  if (event.key === 'ArrowLeft') x.value -= step;
  if (event.key === 'ArrowRight') x.value += step;
  if (event.key === 'ArrowUp') y.value -= step;
  if (event.key === 'ArrowDown') y.value += step;
  draw();
}
async function save() {
  if (!bitmap.value || !canvas.value || locked.value) return;
  exporting.value = true;
  error.value = '';
  try {
    for (const quality of [0.82, 0.65, 0.45]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.value!.toBlob(resolve, 'image/webp', quality),
      );
      if (blob?.type === 'image/webp' && blob.size <= 192 * 1024) {
        emit('save', blob);
        return;
      }
    }
    throw new Error('图片暂时无法压缩，请重新选择一张图片');
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '暂时无法保存头像';
  } finally {
    exporting.value = false;
  }
}
watch(() => props.file, load);
onMounted(() => {
  dialog.value?.showModal();
  void load();
});
onBeforeUnmount(() => {
  generation++;
  bitmap.value?.close();
  dialog.value?.close();
});
</script>
<template>
  <dialog
    ref="dialog"
    class="dialog avatar-editor"
    aria-labelledby="avatar-editor-title"
    @cancel.prevent="!locked && emit('cancel')"
  >
    <div class="dialog-head">
      <h2 id="avatar-editor-title">调整头像</h2>
      <button
        type="button"
        class="icon-button"
        aria-label="关闭头像编辑"
        :disabled="locked"
        @click="emit('cancel')"
      >
        <AppIcon name="close" />
      </button>
    </div>
    <p id="avatar-crop-help">拖动图片调整位置，滑动下方滑块缩放。也可以使用方向键移动图片。</p>
    <p v-if="loading" role="status">正在读取图片…</p>
    <div v-show="bitmap" class="avatar-crop-wrap">
      <canvas
        ref="canvas"
        class="avatar-crop"
        width="256"
        height="256"
        tabindex="0"
        role="img"
        aria-label="头像裁剪区域"
        aria-describedby="avatar-crop-help"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="end"
        @lostpointercapture="end"
        @keydown="key"
      ></canvas>
      <label class="avatar-zoom"
        >缩放<input
          type="range"
          min="1"
          max="3"
          step="0.01"
          :value="zoom"
          :disabled="locked"
          aria-label="缩放头像"
          @input="changeZoom"
      /></label>
    </div>
    <p v-if="error || saveError" class="notice warm" role="alert">{{ error || saveError }}</p>
    <div class="actions avatar-editor-actions">
      <button type="button" class="text-button" :disabled="locked" @click="emit('choose')">
        重新选图
      </button>
      <button type="button" class="btn secondary" :disabled="locked" @click="emit('cancel')">
        取消
      </button>
      <button
        type="button"
        class="btn primary"
        :disabled="locked || loading || !bitmap"
        @click="save"
      >
        {{ locked ? '正在保存…' : '保存头像' }}
      </button>
    </div>
  </dialog>
</template>
