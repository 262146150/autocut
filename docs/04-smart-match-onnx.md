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

后端日志会显示：

- `ONNX匹配：已加载 onnx-clip-v1`
- 或 `ONNX匹配：...，使用本地索引匹配`
