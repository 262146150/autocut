import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { FFMPEG, probeDuration, run } from "../poc/pipeline.mjs";
import { cosineSimilarity, loadSmartOnnxProvider } from "./onnx_embedder.mjs";
import { callArkText } from "./llm.mjs";

const STOP_WORDS = new Set([
  "的", "了", "和", "与", "及", "在", "是", "有", "就", "都", "也", "很", "让", "把",
  "一个", "一种", "这个", "那个", "我们", "你们", "他们", "进行", "可以", "没有",
  "the", "and", "for", "with", "from", "this", "that", "video", "clip",
]);

const SEMANTIC_ALIASES = [
  ["电饭煲", ["厨房", "做饭", "米饭", "家电", "煮饭", "饭锅"]],
  ["厨房", ["做饭", "烹饪", "家居", "锅具", "餐饮"]],
  ["做饭", ["厨房", "烹饪", "食物", "餐饮", "料理"]],
  ["食物", ["美食", "餐饮", "吃饭", "料理", "厨房"]],
  ["咖啡", ["饮品", "杯子", "办公室", "休闲", "生活"]],
  ["办公室", ["办公", "职场", "上班", "电脑", "桌面"]],
  ["上班", ["职场", "办公室", "通勤", "工作", "白领"]],
  ["家", ["居家", "客厅", "卧室", "生活", "家庭"]],
  ["手机", ["数码", "屏幕", "拍摄", "通讯", "科技"]],
  ["电脑", ["办公", "科技", "桌面", "工作", "数码"]],
  ["汽车", ["车", "出行", "驾驶", "交通", "路上"]],
  ["旅行", ["风景", "户外", "出行", "城市", "自然"]],
  ["运动", ["健身", "跑步", "户外", "健康", "训练"]],
  ["护肤", ["美妆", "化妆", "面部", "女性", "产品"]],
  ["口红", ["美妆", "化妆", "女性", "彩妆", "产品"]],
  ["服装", ["穿搭", "衣服", "时尚", "模特", "搭配"]],
  ["宝宝", ["母婴", "孩子", "儿童", "家庭", "亲子"]],
  ["宠物", ["猫", "狗", "动物", "陪伴", "生活"]],
  ["装修", ["家居", "房间", "空间", "设计", "室内"]],
  ["优惠", ["促销", "价格", "购买", "活动", "福利"]],
  ["产品", ["商品", "展示", "细节", "特写", "卖点"]],
  ["细节", ["特写", "局部", "质感", "产品", "展示"]],
];

const IMAGE_UNDERSTANDING_LABELS = [
  "产品特写", "商品展示", "包装盒", "细节质感", "使用步骤", "前后对比", "开箱", "促销优惠",
  "商品海报", "促销海报", "宣传海报", "广告图", "主图", "详情页",
  "厨房", "做饭", "电饭煲", "锅具", "餐桌", "食物", "饮品", "咖啡", "烘焙", "水果", "蔬菜",
  "办公室", "办公桌", "电脑", "手机", "平板电脑", "数码产品", "会议", "职场", "通勤", "学习",
  "客厅", "卧室", "卫生间", "阳台", "家居", "装修", "收纳", "清洁", "洗衣", "家庭生活",
  "人物正面", "人物背影", "手部动作", "女性", "男性", "老人", "儿童", "宝宝", "亲子", "情侣",
  "护肤", "美妆", "口红", "化妆品", "穿搭", "服装", "鞋子", "包包", "首饰", "时尚街拍",
  "运动", "健身", "跑步", "瑜伽", "户外", "健康", "训练", "游泳", "骑行", "球类运动",
  "汽车", "驾驶", "道路", "停车场", "车内", "公共交通", "飞机", "高铁", "旅行", "酒店",
  "城市街道", "商场", "门店", "餐厅", "咖啡店", "超市", "货架", "招牌", "人群", "夜景",
  "自然风景", "山", "海边", "天空", "花草", "森林", "湖泊", "日出", "日落", "雪景",
  "宠物", "猫", "狗", "动物", "植物", "农田", "工厂", "仓库", "机器设备", "工具",
  "红色背景", "蓝色背景", "绿色背景", "白色背景", "黑色背景", "简洁背景", "复杂背景",
  "海报文字", "截图", "数据图表", "证件资料", "聊天界面", "支付界面", "地图导航",
  "开心", "温馨", "高级感", "科技感", "专业", "轻松", "忙碌", "治愈", "精致", "真实生活",
];

const CLIP_UNDERSTANDING_LABELS = Array.from(new Set([
  ...IMAGE_UNDERSTANDING_LABELS,
  "产品展示", "产品细节", "商品讲解", "使用产品", "手持展示", "开箱展示", "教程步骤", "结果展示",
  "人物口播", "直播口播", "人物讲解", "采访对话", "情绪反应", "手部操作", "走路移动", "工作过程",
  "厨房做饭", "办公室工作", "居家生活", "门店展示", "工厂生产", "仓库打包", "户外行走", "旅行记录",
  "近景特写", "中景人物", "远景环境", "环境铺垫", "动作过程", "强视觉开头", "细节补充", "真实使用",
]));

const labelEmbeddingCache = new Map();

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_\-./\\()[\]{}]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function charNgrams(text, size) {
  const chars = Array.from(text.replace(/\s+/g, ""));
  if (chars.length < size) return [];
  const grams = [];
  for (let i = 0; i <= chars.length - size; i++) grams.push(chars.slice(i, i + size).join(""));
  return grams;
}

function tokenize(value) {
  const normalized = normalizeText(value);
  const wordTokens = normalized.split(/\s+/).filter((token) => token && !STOP_WORDS.has(token));
  const grams = [
    ...charNgrams(normalized, 2),
    ...charNgrams(normalized, 3),
  ].filter((token) => token && !STOP_WORDS.has(token));
  const aliases = [];
  for (const [keyword, related] of SEMANTIC_ALIASES) {
    if (normalized.includes(keyword) || wordTokens.includes(keyword)) {
      aliases.push(keyword, ...related);
    } else if (related.some((word) => normalized.includes(word) || wordTokens.includes(word))) {
      aliases.push(keyword, ...related);
    }
  }
  return Array.from(new Set([...wordTokens, ...grams, ...aliases].filter((token) => token && !STOP_WORDS.has(token))));
}

function tokenScore(queryTokens, targetTokens) {
  if (!queryTokens.length || !targetTokens.length) return 0;
  const target = new Set(targetTokens);
  let score = 0;
  for (const token of queryTokens) {
    if (target.has(token)) score += token.length >= 3 ? 2 : 1;
  }
  return score / Math.max(1, queryTokens.length);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotate(items, offset) {
  if (!items.length) return [];
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const match = body.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!match) throw new Error("AI匹配未返回有效结构");
  return JSON.parse(match[0]);
}

function indexKey(items, modelKey = "") {
  const hash = createHash("sha1");
  hash.update(modelKey);
  hash.update("\n");
  for (const item of items) {
    hash.update(item.path);
    hash.update(":");
    hash.update(String(item.size));
    hash.update(":");
    hash.update(String(Math.round(item.mtimeMs)));
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 16);
}

async function clipFingerprint(clip) {
  const info = await stat(clip);
  return {
    path: clip,
    size: info.size,
    mtimeMs: info.mtimeMs,
  };
}

function clipText(clip) {
  const base = path.basename(clip, path.extname(clip));
  const dir = path.basename(path.dirname(clip));
  return `${dir} ${base}`;
}

function imageText(image) {
  const base = path.basename(image, path.extname(image));
  const dir = path.basename(path.dirname(image));
  return `${dir} ${base}`;
}

function inferFilenameTags(file) {
  const text = normalizeText(imageText(file));
  const rules = [
    [/海报|poster|banner|主图|详情页/, ["商品海报", "海报文字", "商品展示"]],
    [/电饭煲|饭锅|煮饭/, ["电饭煲", "厨房", "做饭", "家电"]],
    [/厨房|烹饪|做饭|料理/, ["厨房", "做饭", "食物"]],
    [/办公室|办公|职场|上班/, ["办公室", "办公桌", "职场"]],
    [/电脑|笔记本|pc|mac/, ["电脑", "办公", "数码产品"]],
    [/手机|iphone|安卓|数码/, ["手机", "数码产品", "科技感"]],
    [/咖啡|饮品|奶茶|茶/, ["饮品", "咖啡", "生活"]],
    [/护肤|面霜|精华|口红|美妆|化妆/, ["护肤", "美妆", "产品特写"]],
    [/衣服|服装|穿搭|鞋|包/, ["穿搭", "服装", "时尚街拍"]],
    [/汽车|轿车|车辆|驾驶|车内|停车/, ["汽车", "驾驶", "出行"]],
    [/旅行|旅游|风景|山景|海边|海滩|城市风光|户外/, ["旅行", "自然风景", "户外"]],
    [/宝宝|儿童|孩子|亲子|母婴/, ["宝宝", "儿童", "亲子"]],
    [/猫|狗|宠物/, ["宠物", "猫", "狗"]],
    [/促销|优惠|福利|折扣|价格/, ["促销优惠", "商品展示", "购买"]],
  ];
  const tags = [];
  for (const [pattern, values] of rules) {
    if (pattern.test(text)) tags.push(...values);
  }
  return Array.from(new Set(tags));
}

function annotationForPath(annotations, file) {
  if (!annotations) return null;
  if (annotations instanceof Map) return annotations.get(file) || annotations.get(path.resolve(file)) || null;
  return annotations[file] || annotations[path.resolve(file)] || null;
}

function splitAnnotationKeywords(value) {
  return String(value || "")
    .split(/[,\n，、;；\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function annotationText(annotation) {
  if (!annotation) return "";
  return [
    annotation.keywords,
    annotation.description,
    annotation.usageHint || annotation.usage_hint,
  ].filter(Boolean).join(" ");
}

function labelCacheKey(onnxProvider, namespace, labels) {
  const labelsKey = createHash("sha1").update(labels.join("\n")).digest("hex").slice(0, 10);
  return `${onnxProvider.modelKey || onnxProvider.engine || "default"}:${namespace}:${labelsKey}`;
}

async function semanticLabelVectors(onnxProvider, labels, namespace, promptForLabel) {
  if (!onnxProvider?.available) return [];
  const key = labelCacheKey(onnxProvider, namespace, labels);
  if (labelEmbeddingCache.has(key)) return labelEmbeddingCache.get(key);
  const rows = [];
  for (const label of labels) {
    try {
      const embedding = await onnxProvider.embedText(promptForLabel(label));
      rows.push({ label, embedding });
    } catch {
      // Keep zero-shot tagging optional; CLIP retrieval can still work without label vectors.
    }
  }
  labelEmbeddingCache.set(key, rows);
  return rows;
}

async function understandWithLabels(embedding, onnxProvider, labels, namespace, promptForLabel, captionPrefix) {
  if (!embedding || !onnxProvider?.available) return { tags: [], tagScores: [], caption: "" };
  const vectors = await semanticLabelVectors(onnxProvider, labels, namespace, promptForLabel);
  const ranked = vectors
    .map((item) => ({
      label: item.label,
      score: Math.max(0, cosineSimilarity(embedding, item.embedding)),
    }))
    .sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 8);
  const confident = top.filter((item, index) => index < 4 || item.score >= Math.max(0.18, top[0]?.score * 0.92));
  const tags = confident.map((item) => item.label);
  return {
    tags,
    tagScores: top.map((item) => ({ label: item.label, score: Number(item.score.toFixed(3)) })),
    caption: tags.length ? `${captionPrefix}：${tags.join("、")}` : "",
  };
}

async function understandImageWithLabels(embedding, onnxProvider) {
  return understandWithLabels(
    embedding,
    onnxProvider,
    IMAGE_UNDERSTANDING_LABELS,
    "image",
    (label) => `一张关于${label}的图片`,
    "图片可能包含",
  );
}

async function understandClipWithLabels(embedding, onnxProvider) {
  return understandWithLabels(
    embedding,
    onnxProvider,
    CLIP_UNDERSTANDING_LABELS,
    "clip",
    (label) => `一段关于${label}的短视频画面`,
    "视频可能包含",
  );
}

function candidateCard(item, id) {
  const indexedClip = item.indexedClip ?? {};
  return {
    id,
    name: indexedClip.name || path.basename(item.clip),
    directory: indexedClip.dirName || path.basename(path.dirname(item.clip)),
    text: indexedClip.text || clipText(item.clip),
    tags: Array.isArray(indexedClip.tags) ? indexedClip.tags.slice(0, 8) : [],
    caption: indexedClip.caption || "",
    durationSec: Number((indexedClip.durationSec || item.durationSec || 0).toFixed?.(1) ?? 0),
    localScore: Number(item.score.toFixed(3)),
    lexicalScore: Number(item.lexicalScore.toFixed(3)),
    vectorScore: Number(item.vectorScore.toFixed(3)),
  };
}

async function rerankWithLlm(ranked, prompt, options = {}) {
  const topK = Math.max(6, Math.min(40, Math.floor(Number(options.topK) || 24)));
  const candidates = ranked.slice(0, topK);
  const cards = candidates.map((item, index) => candidateCard(item, `c${index + 1}`));
  const request = [
    "你是短视频混剪的画面匹配助手。请根据用户文案，从候选素材中选出最适合承接这段文案的画面顺序。",
    "判断依据：场景、动作、物体、人物状态、情绪氛围、内容主题、开头吸引力和画面连贯性。",
    "候选素材已经过本地向量召回，localScore/vectorScore 只能作为参考；如果素材标题或目录语义更贴近文案，可以提高排序。",
    "只输出 JSON 数组，不要解释。数组元素格式：",
    "{\"id\":\"c1\",\"score\":0.92,\"reason\":\"20字以内匹配理由\"}",
    "要求：只使用候选中的 id，不要新增 id；至少返回 8 个，按推荐顺序排列。",
    "",
    "用户文案：",
    String(prompt || "").trim(),
    "",
    "候选素材：",
    JSON.stringify(cards, null, 2),
  ].join("\n");
  const { text } = await callArkText(request, {
    apiKey: options.apiKey,
    model: options.model,
    maxOutputTokens: 4096,
  });
  const parsed = extractJson(text);
  const rows = Array.isArray(parsed) ? parsed : [];
  const byId = new Map(rows.map((row) => [String(row?.id || ""), row]));
  const candidateById = new Map(candidates.map((item, index) => [`c${index + 1}`, item]));
  const used = new Set();
  const reranked = [];
  for (const row of rows) {
    const id = String(row?.id || "");
    const item = candidateById.get(id);
    if (!item || used.has(id)) continue;
    used.add(id);
    const rawScore = Number(row?.score);
    reranked.push({
      ...item,
      score: Number.isFinite(rawScore) ? Math.max(0, Math.min(1, rawScore)) : item.score,
      reason: "llm-rerank",
      rerankScore: Number.isFinite(rawScore) ? Math.max(0, Math.min(1, rawScore)) : null,
      rerankReason: String(row?.reason || "").trim(),
    });
  }
  for (let i = 0; i < candidates.length; i++) {
    const id = `c${i + 1}`;
    if (!used.has(id)) {
      const row = byId.get(id);
      reranked.push({
        ...candidates[i],
        rerankScore: row ? Number(row.score) || null : null,
        rerankReason: row ? String(row.reason || "").trim() : "",
      });
    }
  }
  const rest = ranked.slice(candidates.length);
  return {
    ranked: [...reranked, ...rest],
    topK: candidates.length,
  };
}

async function extractThumb(clip, output, duration, ratio) {
  const at = Math.max(0.1, Math.min(Math.max(0.1, duration - 0.1), duration * ratio));
  await run(FFMPEG, [
    "-y",
    "-ss", at.toFixed(3),
    "-i", clip,
    "-frames:v", "1",
    "-vf", "scale=224:224:force_original_aspect_ratio=decrease,pad=224:224:(ow-iw)/2:(oh-ih)/2,format=yuvj420p",
    "-q:v", "3",
    output,
  ]);
}

async function buildClipEntry(clip, fingerprint, dir, index, onnxProvider) {
  const durationSec = await probeDuration(clip);
  const safeBase = `${String(index + 1).padStart(5, "0")}_${createHash("sha1").update(clip).digest("hex").slice(0, 8)}`;
  const thumbs = [];
  for (const ratio of [0.2, 0.5, 0.8]) {
    const thumb = path.join(dir, `${safeBase}_${Math.round(ratio * 100)}.jpg`);
    try {
      if (!existsSync(thumb)) await extractThumb(clip, thumb, durationSec || 1, ratio);
      thumbs.push(thumb);
    } catch {
      // Some browser-supported files still fail frame extraction; keep the clip indexed.
    }
  }
  const embedding = onnxProvider?.available ? await onnxProvider.embedImages(thumbs) : null;
  const understanding = await understandClipWithLabels(embedding, onnxProvider);
  const filenameTags = inferFilenameTags(clip);
  const tags = Array.from(new Set([...filenameTags, ...understanding.tags]));
  const caption = tags.length ? `视频可能包含：${tags.join("、")}` : understanding.caption;
  const text = [
    clipText(clip),
    caption,
    ...tags,
  ].filter(Boolean).join(" ");
  return {
    ...fingerprint,
    name: path.basename(clip),
    dirName: path.basename(path.dirname(clip)),
    durationSec,
    text,
    tokens: tokenize(text),
    thumbs,
    embedding,
    tags,
    tagScores: understanding.tagScores,
    caption,
  };
}

async function buildImageEntry(image, fingerprint, index, onnxProvider, annotation = null) {
  const embedding = onnxProvider?.available ? await onnxProvider.embedImages([image]) : null;
  const understanding = await understandImageWithLabels(embedding, onnxProvider);
  const filenameTags = inferFilenameTags(image);
  const manualKeywords = splitAnnotationKeywords(annotation?.keywords);
  const manualText = annotationText(annotation);
  const tags = Array.from(new Set([...manualKeywords, ...filenameTags, ...understanding.tags]));
  const caption = annotation?.description
    ? `人工描述：${annotation.description}`
    : tags.length ? `图片可能包含：${tags.join("、")}` : understanding.caption;
  const text = [
    manualText,
    manualText,
    imageText(image),
    caption,
    ...tags,
  ].filter(Boolean).join(" ");
  return {
    ...fingerprint,
    name: path.basename(image),
    dirName: path.basename(path.dirname(image)),
    text,
    tokens: tokenize(text),
    embedding,
    tags,
    tagScores: understanding.tagScores,
    caption,
    annotation: annotation ? {
      keywords: annotation.keywords || "",
      description: annotation.description || "",
      usageHint: annotation.usageHint || annotation.usage_hint || "",
      updatedAt: annotation.updatedAt || annotation.updated_at || "",
    } : null,
    durationSec: 0,
    thumbs: [image],
    index,
  };
}

export async function buildSmartMaterialIndex(clips, options = {}) {
  const cacheDir = options.cacheDir || path.join(process.cwd(), "_cache", "smart-index");
  const onnxProvider = await loadSmartOnnxProvider({ root: options.root || process.cwd() });
  if (onnxProvider.available) {
    options.onEvent?.({ type: "log", msg: "智能匹配：已启用本地画面分析" });
  } else {
    options.onEvent?.({ type: "log", msg: "智能匹配：使用文件名和目录信息分析素材" });
  }
  const fingerprints = [];
  for (const clip of clips) {
    try {
      fingerprints.push(await clipFingerprint(clip));
    } catch {
      // Deleted or unreadable files are ignored; collectClips has already filtered the main list.
    }
  }
  const key = indexKey(fingerprints, onnxProvider.available ? onnxProvider.modelKey : "");
  const dir = path.join(cacheDir, key);
  const indexPath = path.join(dir, "index.json");
  await mkdir(dir, { recursive: true });
  if (existsSync(indexPath)) {
    try {
      const cached = JSON.parse(await readFile(indexPath, "utf8"));
      if (cached.version === 4 && Array.isArray(cached.clips) && cached.clips.length === fingerprints.length) {
        return { ...cached, reused: true, path: indexPath, onnxProvider };
      }
    } catch {
      // Rebuild invalid cache files.
    }
  }
  options.onEvent?.({ type: "log", msg: `智能索引：开始分析 ${fingerprints.length} 个素材…` });
  if (onnxProvider.available) {
    options.onEvent?.({ type: "log", msg: "素材画像：正在生成场景和画面标签" });
  }
  const entries = [];
  for (let i = 0; i < fingerprints.length; i++) {
    const item = fingerprints[i];
    if (i === 0 || (i + 1) % 10 === 0 || i === fingerprints.length - 1) {
      options.onEvent?.({ type: "log", msg: `智能索引：${i + 1}/${fingerprints.length}` });
    }
    entries.push(await buildClipEntry(item.path, item, dir, i, onnxProvider.available ? onnxProvider : null));
  }
  const index = {
    version: 4,
    engine: onnxProvider.available ? `${onnxProvider.engine}+clip-tags-v1` : "local-frame-index-v3",
    createdAt: new Date().toISOString(),
    key,
    onnx: {
      available: onnxProvider.available,
      reason: onnxProvider.available ? "" : onnxProvider.reason,
      manifestPath: onnxProvider.manifestPath || "",
      modelKey: onnxProvider.modelKey || "",
    },
    clips: entries,
  };
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  return { ...index, reused: false, path: indexPath, onnxProvider };
}

export async function buildSmartImageIndex(images, options = {}) {
  const cacheDir = options.cacheDir || path.join(process.cwd(), "_cache", "smart-image-index");
  const onnxProvider = await loadSmartOnnxProvider({ root: options.root || process.cwd() });
  if (onnxProvider.available) {
    options.onEvent?.({ type: "log", msg: `图片匹配：已加载 ${onnxProvider.engine}` });
  } else {
    options.onEvent?.({ type: "log", msg: `图片匹配：${onnxProvider.reason}，使用文件名匹配` });
  }
  const fingerprints = [];
  for (const image of images) {
    try {
      fingerprints.push(await clipFingerprint(image));
    } catch {
      // Deleted or unreadable files are ignored.
    }
  }
  const annotationKey = fingerprints
    .map((item) => {
      const annotation = annotationForPath(options.annotations, item.path);
      return annotation ? `${item.path}:${annotation.updatedAt || annotation.updated_at || ""}:${annotationText(annotation)}` : item.path;
    })
    .join("\n");
  const key = indexKey(fingerprints, `${onnxProvider.available ? `image-${onnxProvider.modelKey}` : "image-local"}\n${annotationKey}`);
  const dir = path.join(cacheDir, key);
  const indexPath = path.join(dir, "index.json");
  await mkdir(dir, { recursive: true });
  if (existsSync(indexPath)) {
    try {
      const cached = JSON.parse(await readFile(indexPath, "utf8"));
      if (cached.version === 4 && Array.isArray(cached.images) && cached.images.length === fingerprints.length) {
        return { ...cached, reused: true, path: indexPath, onnxProvider };
      }
    } catch {
      // Rebuild invalid cache files.
    }
  }
  options.onEvent?.({ type: "log", msg: `图片索引：开始分析 ${fingerprints.length} 张图片…` });
  if (onnxProvider.available) {
    options.onEvent?.({ type: "log", msg: "图片理解：正在生成本地语义标签" });
  }
  const entries = [];
  for (let i = 0; i < fingerprints.length; i++) {
    if (i === 0 || (i + 1) % 20 === 0 || i === fingerprints.length - 1) {
      options.onEvent?.({ type: "log", msg: `图片索引：${i + 1}/${fingerprints.length}` });
    }
    entries.push(await buildImageEntry(
      fingerprints[i].path,
      fingerprints[i],
      i,
      onnxProvider.available ? onnxProvider : null,
      annotationForPath(options.annotations, fingerprints[i].path),
    ));
  }
  const index = {
    version: 4,
    engine: onnxProvider.available ? `${onnxProvider.engine}+zero-shot-tags-v1` : "local-image-semantic-v1",
    createdAt: new Date().toISOString(),
    key,
    onnx: {
      available: onnxProvider.available,
      reason: onnxProvider.available ? "" : onnxProvider.reason,
      manifestPath: onnxProvider.manifestPath || "",
      modelKey: onnxProvider.modelKey || "",
    },
    images: entries,
  };
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  return { ...index, reused: false, path: indexPath, onnxProvider };
}

export async function rankClipsForPrompt(clips, prompt, options = {}) {
  const queryTokens = tokenize(prompt);
  const fallbackOffset = stableHash(prompt) % Math.max(1, clips.length);
  const indexed = new Map((options.index?.clips ?? []).map((item) => [item.path, item]));
  const textEmbedding = options.index?.onnxProvider?.available
    ? await options.index.onnxProvider.embedText(prompt).catch(() => null)
    : null;
  const ranked = clips
    .map((clip, index) => {
      const indexedClip = indexed.get(clip);
      const clipTokens = indexedClip?.tokens?.length ? indexedClip.tokens : tokenize(clipText(clip));
      const lexicalScore = tokenScore(queryTokens, clipTokens);
      const vectorScore = textEmbedding && indexedClip?.embedding
        ? Math.max(0, cosineSimilarity(textEmbedding, indexedClip.embedding))
        : 0;
      const semanticScore = Math.min(1, lexicalScore);
      const score = vectorScore > 0
        ? Math.min(1, vectorScore * 0.82 + semanticScore * 0.18)
        : semanticScore;
      return {
        clip,
        index,
        indexedClip,
        score,
        reason: vectorScore > 0 ? (semanticScore > 0 ? "vector-semantic" : "onnx-vector") : score > 0 ? (indexedClip ? "smart-index" : "filename") : "fallback",
        lexicalScore,
        vectorScore,
        thumbs: indexedClip?.thumbs ?? [],
        durationSec: indexedClip?.durationSec ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let finalRanked = ranked;
  let reranked = false;
  let rerankTopK = 0;
  if (options.llm?.apiKey && ranked.length) {
    try {
      options.onEvent?.({ type: "log", msg: "深度匹配：正在重排候选画面" });
      const result = await rerankWithLlm(ranked, prompt, {
        apiKey: options.llm.apiKey,
        model: options.llm.model,
        topK: options.rerankTopK,
      });
      finalRanked = result.ranked;
      reranked = true;
      rerankTopK = result.topK;
      options.onEvent?.({ type: "log", msg: `深度匹配：已重排 ${rerankTopK} 个候选画面` });
    } catch (error) {
      options.onEvent?.({ type: "log", msg: `深度匹配失败，已使用本地匹配：${error.message}` });
    }
  }
  const ordered = finalRanked.map((item) => item.clip);
  const hasMatch = finalRanked.some((item) => item.score > 0);
  const baseEngine = textEmbedding && ranked.some((item) => item.vectorScore > 0)
    ? options.index?.engine || "onnx-clip-v1"
    : options.index?.engine
      ? `${options.index.engine}${hasMatch ? "" : "-fallback"}`
      : hasMatch ? "local-lexical-v1" : "local-lexical-v1-fallback";
  return {
    clips: hasMatch ? ordered : rotate(clips, fallbackOffset),
    matches: finalRanked.slice(0, Math.min(8, finalRanked.length)).map((item) => ({
      name: path.basename(item.clip),
      score: Number(item.score.toFixed(3)),
      reason: item.reason,
      lexicalScore: Number(item.lexicalScore.toFixed(3)),
      vectorScore: Number(item.vectorScore.toFixed(3)),
      rerankScore: item.rerankScore === undefined || item.rerankScore === null ? undefined : Number(item.rerankScore.toFixed(3)),
      rerankReason: item.rerankReason || undefined,
      thumbs: item.thumbs,
      durationSec: item.durationSec,
      tags: item.indexedClip?.tags || [],
      caption: item.indexedClip?.caption || "",
    })),
    engine: reranked ? `${baseEngine}+llm-rerank` : baseEngine,
    reranked,
    rerankTopK,
    indexPath: options.index?.path,
  };
}

export async function rankImagesForPrompt(images, prompt, options = {}) {
  const queryTokens = tokenize(prompt);
  const fallbackOffset = stableHash(prompt) % Math.max(1, images.length);
  const indexed = new Map((options.index?.images ?? []).map((item) => [item.path, item]));
  const textEmbedding = options.index?.onnxProvider?.available
    ? await options.index.onnxProvider.embedText(prompt).catch(() => null)
    : null;
  const ranked = images
    .map((image, index) => {
      const indexedClip = indexed.get(image);
      const imageTokens = indexedClip?.tokens?.length ? indexedClip.tokens : tokenize(imageText(image));
      const lexicalScore = tokenScore(queryTokens, imageTokens);
      const vectorScore = textEmbedding && indexedClip?.embedding
        ? Math.max(0, cosineSimilarity(textEmbedding, indexedClip.embedding))
        : 0;
      const score = vectorScore > 0 ? vectorScore : lexicalScore;
      return {
        clip: image,
        index,
        indexedClip,
        score,
        reason: vectorScore > 0 ? "onnx-vector" : score > 0 ? (indexedClip ? "image-index" : "filename") : "fallback",
        lexicalScore,
        vectorScore,
        thumbs: indexedClip?.thumbs ?? [image],
        durationSec: 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let finalRanked = ranked;
  let reranked = false;
  let rerankTopK = 0;
  if (options.llm?.apiKey && ranked.length) {
    try {
      options.onEvent?.({ type: "log", msg: "深度匹配：正在重排候选图片" });
      const result = await rerankWithLlm(ranked, prompt, {
        apiKey: options.llm.apiKey,
        model: options.llm.model,
        topK: options.rerankTopK,
      });
      finalRanked = result.ranked;
      reranked = true;
      rerankTopK = result.topK;
      options.onEvent?.({ type: "log", msg: `深度匹配：已重排 ${rerankTopK} 张候选图片` });
    } catch (error) {
      options.onEvent?.({ type: "log", msg: `深度匹配失败，已使用本地图片匹配：${error.message}` });
    }
  }
  const ordered = finalRanked.map((item) => item.clip);
  const hasMatch = finalRanked.some((item) => item.score > 0);
  const baseEngine = textEmbedding && ranked.some((item) => item.vectorScore > 0)
    ? options.index?.engine || "onnx-image-v1"
    : options.index?.engine
      ? `${options.index.engine}${hasMatch ? "" : "-fallback"}`
      : hasMatch ? "local-image-name-v1" : "local-image-name-v1-fallback";
  return {
    images: hasMatch ? ordered : rotate(images, fallbackOffset),
    matches: finalRanked.slice(0, Math.min(8, finalRanked.length)).map((item) => ({
      name: path.basename(item.clip),
      score: Number(item.score.toFixed(3)),
      reason: item.reason,
      lexicalScore: Number(item.lexicalScore.toFixed(3)),
      vectorScore: Number(item.vectorScore.toFixed(3)),
      rerankScore: item.rerankScore === undefined || item.rerankScore === null ? undefined : Number(item.rerankScore.toFixed(3)),
      rerankReason: item.rerankReason || undefined,
      thumbs: item.thumbs,
      tags: item.indexedClip?.tags || [],
      caption: item.indexedClip?.caption || "",
    })),
    engine: reranked ? `${baseEngine}+llm-rerank` : baseEngine,
    reranked,
    rerankTopK,
    indexPath: options.index?.path,
  };
}

function distributeSlots(scenes, targetCount) {
  const count = Math.max(1, Math.floor(Number(targetCount) || 1));
  const size = Math.max(1, scenes.length);
  const slots = Array(size).fill(0);
  for (let i = 0; i < Math.min(size, count); i++) slots[i] = 1;
  let remaining = Math.max(0, count - slots.reduce((sum, value) => sum + value, 0));
  const weighted = scenes.map((scene, index) => ({
    index,
    weight: Math.max(1, Array.from(String(scene || "")).length),
  })).sort((a, b) => b.weight - a.weight || a.index - b.index);
  let cursor = 0;
  while (remaining > 0) {
    slots[weighted[cursor % weighted.length].index] += 1;
    cursor += 1;
    remaining -= 1;
  }
  return slots;
}

function chooseFromRanked(rankedImages, used, allowRepeat, globalOrder = new Map()) {
  const ranked = rankedImages
    .filter(Boolean)
    .map((image, index) => ({ image, index, globalIndex: globalOrder.has(image) ? globalOrder.get(image) : 999999 }))
    .sort((a, b) => (a.index + a.globalIndex * 0.04) - (b.index + b.globalIndex * 0.04));
  const fresh = ranked.find((item) => !used.has(item.image));
  if (fresh) {
    used.add(fresh.image);
    return fresh.image;
  }
  if (allowRepeat && ranked.length) return ranked[0].image;
  return "";
}

function indexedClipMap(index) {
  return new Map((index?.clips ?? []).map((item) => [item.path, item]));
}

function chooseClipFromRanked(rankedClips, used, recent, allowRepeat, indexed, globalOrder = new Map()) {
  const candidates = rankedClips
    .filter(Boolean)
    .map((clip, index) => {
      const info = indexed.get(clip);
      const last = recent[recent.length - 1];
      let penalty = 0;
      if (used.has(clip)) penalty += allowRepeat ? 18 : 999999;
      if (last && path.dirname(last) === path.dirname(clip)) penalty += 2.5;
      if (last && path.basename(last) === path.basename(clip)) penalty += 999999;
      const embedding = info?.embedding;
      if (embedding && recent.length) {
        const similarRecent = recent
          .map((item) => indexed.get(item)?.embedding)
          .filter(Boolean)
          .map((itemEmbedding) => cosineSimilarity(embedding, itemEmbedding))
          .sort((a, b) => b - a)[0] ?? 0;
        if (similarRecent > 0.94) penalty += 5;
        else if (similarRecent > 0.88) penalty += 2;
      }
      const globalIndex = globalOrder.has(clip) ? globalOrder.get(clip) : 999999;
      return {
        clip,
        score: index + globalIndex * 0.04 + penalty,
      };
    })
    .filter((item) => item.score < 999999)
    .sort((a, b) => a.score - b.score);
  const picked = candidates[0]?.clip || "";
  if (picked) {
    used.add(picked);
    recent.push(picked);
    if (recent.length > 4) recent.shift();
  }
  return picked;
}

export async function rankClipsForScenes(clips, scenes, targetCount, options = {}) {
  const cleanScenes = (Array.isArray(scenes) ? scenes : [])
    .map((scene) => String(scene || "").trim())
    .filter(Boolean);
  const prompts = cleanScenes.length ? cleanScenes : [String(options.prompt || "").trim()].filter(Boolean);
  if (!prompts.length) {
    return await rankClipsForPrompt(clips, "", options);
  }

  let globalRank = null;
  if (options.llm?.apiKey) {
    globalRank = await rankClipsForPrompt(clips, prompts.join("\n"), options);
  }
  const indexed = indexedClipMap(options.index);
  const globalOrder = new Map((globalRank?.clips ?? []).map((clip, index) => [clip, index]));
  const slots = distributeSlots(prompts, Math.max(prompts.length, Math.floor(Number(targetCount) || prompts.length)));
  const used = new Set();
  const recent = [];
  const selected = [];
  const sceneMatches = [];

  for (let i = 0; i < prompts.length; i++) {
    const scene = prompts[i];
    const ranked = await rankClipsForPrompt(clips, scene, { ...options, llm: null });
    const selectedForScene = [];
    for (let slot = 0; slot < slots[i]; slot++) {
      const clip = chooseClipFromRanked(ranked.clips, used, recent, options.allowRepeat !== false, indexed, globalOrder);
      if (clip) {
        selected.push(clip);
        selectedForScene.push(clip);
      }
    }
    sceneMatches.push({
      scene,
      clips: selectedForScene,
      matches: ranked.matches,
      engine: ranked.engine,
    });
  }

  const fallback = globalRank ?? await rankClipsForPrompt(clips, prompts.join("\n"), { ...options, llm: null });
  for (const clip of fallback.clips) {
    if (options.allowRepeat === false && used.has(clip)) continue;
    if (!selected.includes(clip)) selected.push(clip);
  }

  const matchRows = sceneMatches.flatMap((group) => {
    const chosenNames = new Set(group.clips.map((clip) => path.basename(clip)));
    return group.matches
      .filter((item) => chosenNames.has(item.name))
      .map((item) => ({ ...item, scene: group.scene }));
  });
  const fallbackMatches = (globalRank?.matches ?? fallback.matches).map((item) => ({ ...item, scene: prompts[0] || "" }));
  return {
    clips: selected.length ? selected : fallback.clips,
    matches: (matchRows.length ? matchRows : fallbackMatches).slice(0, Math.min(12, clips.length)),
    engine: `${globalRank?.engine || fallback.engine}+scene-diversity-v1`,
    reranked: Boolean(globalRank?.reranked),
    rerankTopK: globalRank?.rerankTopK || 0,
    indexPath: options.index?.path,
    scenes: sceneMatches,
  };
}

export async function rankImagesForScenes(images, scenes, targetCount, options = {}) {
  const cleanScenes = (Array.isArray(scenes) ? scenes : [])
    .map((scene) => String(scene || "").trim())
    .filter(Boolean);
  const prompts = cleanScenes.length ? cleanScenes : [String(options.prompt || "").trim()].filter(Boolean);
  if (!prompts.length) {
    return await rankImagesForPrompt(images, "", options);
  }

  let globalRank = null;
  if (options.llm?.apiKey) {
    globalRank = await rankImagesForPrompt(images, prompts.join("\n"), options);
  }
  const globalOrder = new Map((globalRank?.images ?? []).map((image, index) => [image, index]));
  const slots = distributeSlots(prompts, targetCount);
  const used = new Set();
  const selected = [];
  const sceneMatches = [];

  for (let i = 0; i < prompts.length; i++) {
    const scene = prompts[i];
    const ranked = await rankImagesForPrompt(images, scene, { ...options, llm: null });
    const selectedForScene = [];
    for (let slot = 0; slot < slots[i]; slot++) {
      const image = chooseFromRanked(ranked.images, used, options.allowRepeat !== false, globalOrder);
      if (image) {
        selected.push(image);
        selectedForScene.push(image);
      }
    }
    sceneMatches.push({
      scene,
      images: selectedForScene,
      matches: ranked.matches,
      engine: ranked.engine,
    });
  }

  const fallback = globalRank ?? await rankImagesForPrompt(images, prompts.join("\n"), { ...options, llm: null });
  for (const image of fallback.images) {
    if (selected.length >= Math.max(1, Math.floor(Number(targetCount) || 1))) break;
    if (options.allowRepeat === false && used.has(image)) continue;
    selected.push(image);
    used.add(image);
  }

  const matchRows = sceneMatches.flatMap((group) => {
    const chosen = new Set(group.images);
    return group.matches
      .filter((item) => chosen.has(images.find((image) => path.basename(image) === item.name) || ""))
      .map((item) => ({ ...item, scene: group.scene }));
  });
  const fallbackMatches = (globalRank?.matches ?? fallback.matches).map((item) => ({ ...item, scene: prompts[0] || "" }));
  return {
    images: selected.length ? selected : fallback.images,
    matches: (matchRows.length ? matchRows : fallbackMatches).slice(0, Math.min(12, images.length)),
    engine: `${globalRank?.engine || fallback.engine}+scene-plan-v1`,
    reranked: Boolean(globalRank?.reranked),
    rerankTopK: globalRank?.rerankTopK || 0,
    indexPath: options.index?.path,
    scenes: sceneMatches,
  };
}
