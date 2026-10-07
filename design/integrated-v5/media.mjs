// Image bytes live once in IndexedDB; business records and drafts hold stable references.
const PREFIX = 'media:';
const INLINE = /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/g;
let database;
const urls = new Map();
export const isMediaRef = value => typeof value === 'string' && /^media:[a-zA-Z0-9-]+$/.test(value);
function open() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('tianli-integrated-media-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('图片存储无法打开，请检查浏览器存储权限。')); };
  });
}
export async function saveMedia(blob) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('不支持的图片格式。');
  const bytes = await blob.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  const ref = PREFIX + digest, db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put(blob, ref);
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(new Error('图片保存失败，原资料仍然保留。请释放空间后重试。'));
  });
  return ref;
}
export async function readMedia(file) {
  const metadata = typeof file === 'string' ? { ref: file } : file;
  if (!metadata || typeof metadata !== 'object' || !isMediaRef(metadata.ref)) throw new Error('图片引用无效。');
  if (metadata.type !== undefined && !['image/png', 'image/jpeg', 'image/webp'].includes(metadata.type)
      || metadata.size !== undefined && (!Number.isSafeInteger(metadata.size) || metadata.size < 0)) throw new Error('图片元数据无效。');
  const db = await open();
  const blob = await new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readonly'), request = tx.objectStore('images').get(metadata.ref);
    let value;
    request.onsuccess = () => { value = request.result; };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('图片读取失败，请重试。'));
  });
  if (!blob) throw new Error('图片记录缺失，请在商品管理中重新选择图片。');
  if (!(blob instanceof Blob)) throw new Error('图片记录无效，请在商品管理中重新选择图片。');
  if (metadata.type !== undefined && metadata.type !== blob.type
      || metadata.size !== undefined && metadata.size !== blob.size) throw new Error('图片元数据与实际文件不一致。');
  return blob;
}
export async function mediaUrl(ref) {
  if (!isMediaRef(ref)) return ref;
  if (urls.has(ref)) return urls.get(ref);
  const blob = await readMedia(ref);
  const url = URL.createObjectURL(blob); urls.set(ref, url); return url;
}
export async function externalizeImages(value, save = saveMedia) {
  let serialized = JSON.stringify(value);
  const images = [...new Set(serialized.match(INLINE) || [])];
  if (!images.length) return { value, changed: false, count: 0 };
  // Persist every image before returning a replacement. The caller commits JSON last.
  const references = new Map();
  for (const inline of images) {
    const comma = inline.indexOf(','), mime = inline.slice(5, inline.indexOf(';'));
    const bytes = Uint8Array.from(atob(inline.slice(comma + 1)), char => char.charCodeAt(0));
    const ref = await save(new Blob([bytes], { type: mime }));
    references.set(inline, ref);
  }
  serialized = serialized.replace(INLINE, inline => references.get(inline));
  return { value: JSON.parse(serialized), changed: true, count: images.length };
}
export function mediaMarkup(html) {
  return html.replace(/src="(media:[a-zA-Z0-9-]+)"/g, 'data-media-ref="$1"');
}
export async function showMedia(img, ref) {
  img.dataset.mediaRef = ref;
  if (!ref) { img.hidden = true; img.removeAttribute('src'); return; }
  img.hidden = false;
  try { const url = await mediaUrl(ref); if (img.dataset.mediaRef === ref) { img.src = url; img.removeAttribute('title'); } }
  catch (error) { if (img.dataset.mediaRef === ref) { img.removeAttribute('src'); img.title = error.message; img.alt = error.message; } }
}
export function hydrateMedia(root = document) {
  root.querySelectorAll('img[data-media-ref]').forEach(img => showMedia(img, img.dataset.mediaRef));
}
