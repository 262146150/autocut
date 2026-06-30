# AI Smart Match ONNX

AI 智能混剪的 ONNX 层用于把“文案/音频描述”和“素材关键帧”映射到同一向量空间，再按余弦相似度排序素材。

## Model Layout

默认读取以下任一路径：

- `web/models/smart-match/manifest.json`
- `web/_models/smart-match/manifest.json`
- `app/src-tauri/Resources/models/smart-match/manifest.json`

也可以通过环境变量指定：

```bash
export ECUT_SMART_ONNX_MANIFEST=/path/to/manifest.json
```

推荐模型先用 `zihuv/chinese-clip-vit-base-patch16-onnx`。它是 OFA Chinese-CLIP ViT-B/16 的 ONNX 导出，包含 `visual.onnx`、`text.onnx`、`vocab.txt`，Hugging Face 标注 MIT。

一键下载：

```bash
cd web
pnpm models:smart
```

下载后目录：

```text
web/models/smart-match/
  manifest.json
  visual.onnx
  text.onnx
  vocab.txt
  model_config.json
```

`manifest.example.json` 已放在 `web/models/smart-match/`。真实模型和 `vocab.txt` 不提交到 Git。

## Expected Model Shape

当前适配的是 Chinese-CLIP / CLIP 类双塔模型：

- 图像模型：输入 `pixel_values`，默认 `NCHW`, `1x3x224x224`, float32。
- 文本模型：输入 `input_ids`, `attention_mask`, 可选 `token_type_ids`，int64。
- 输出：图像向量和文本向量维度一致。

字段名、图片尺寸、mean/std、layout 都可在 manifest 中覆盖。

## Runtime Behavior

生成 AI 智能混剪时：

1. 抽取每个素材 3 张关键帧缩略图。
2. 如果 ONNX 可用，为关键帧生成图像向量并缓存到 `web/_cache/smart-index/`。
3. 每条文案或音频描述生成文本向量。
4. 用余弦相似度排序素材；失败时回退到本地文件名/目录名匹配。
5. 如果用户启用“深度匹配”，系统只把本地召回的 Top 候选交给 LLM 重排，不全量发送素材库。

后端日志会显示：

- `ONNX匹配：已加载 onnx-clip-v1`
- 或 `ONNX匹配：...，使用本地索引匹配`
- 深度匹配开启时，会追加 LLM 候选重排；失败时回退本地匹配。

## LLM Rerank

深度匹配不是替代 ONNX，而是二次排序：

1. ONNX / 本地索引先从大量素材中召回候选。
2. 后端构造候选素材卡片，包括文件名、目录、时长、本地分数和向量分数。
3. LLM 根据用户文案对候选卡片重排，返回推荐顺序和简短理由。
4. 混剪仍使用排序后的本地视频文件，不上传原视频。

这个方案比全量 LLM 视频理解更轻，也比纯向量匹配更能处理抽象文案、标题语义和高光切片产出的片段名称。
