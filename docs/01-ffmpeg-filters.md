# ECutAuto — FFmpeg 滤镜配方全集（逆向提取）

> 来源：从 `ECutAuto` 主程序二进制中 `strings` 提取的 filter_complex 片段与完整模板。
> 标注说明：**【完整】** = 从二进制原样还原；**【重建】** = 由碎片+FFmpeg 语义补全，参数位用 `{}` 占位。
> 这些就是该软件全部的视频/音频处理逻辑，可直接照搬到复刻项目。

---

## 0. 通用约定

- 主视频流标签贯穿全程用 `[IN_V]`，主音频用 `[IN_A]`（二进制里反复出现）。
- 每段处理结尾几乎都接：`setsar=1, format=yuv420p, setparams=colorspace=bt709:color_trc=bt709:color_primaries=bt709`
  → 统一 SAR/像素格式/色彩空间，保证拼接不报错、平台不二次转码。
- 时间基统一：`settb=AVTB, setpts=PTS-STARTPTS`（视频）/ `asetpts=PTS-STARTPTS, aresample=async=1:first_pts=0`（音频）。
- 偶数对齐：`force_divisible_by=2` + `floor((main_w-overlay_w)/2/2)*2`（H.264 要求宽高为偶数）。

---

## 1. 画布适配 / 背景虚化填充（blur-fill）★核心

把任意比例素材铺进目标画布：模糊放大铺底 + 原图等比居中。**【完整】**（二进制里 1080p/720p/竖屏全套都在）：

```bash
# 横屏 1920x1080
split[original][copy];
[copy]scale=320:180:force_original_aspect_ratio=increase:flags=fast_bilinear,gblur=sigma=40,scale=1920:1080:flags=fast_bilinear[blurred];
[original]scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos[scaled];
[blurred][scaled]overlay=floor((main_w-overlay_w)/2/2)*2:floor((main_h-overlay_h)/2/2)*2,setsar=1,scale=1920:1080:force_original_aspect_ratio=decrease:flags=fast_bilinear
```

四种目标分辨率（原样提取的参数）：

| 画布 | 模糊底预缩放 | 目标 |
|------|------------|------|
| 横屏 1080p | `320:180` | `1920:1080` |
| 横屏 720p  | `320:180` | `1280:720` |
| 竖屏 1080p | `180:320` | `1080:1920` |
| 竖屏 720p  | `180:320` | `720:1280` |

> 技巧：先缩到 320x180 再 gblur，比直接对全图 gblur 快一个数量级，模糊度还更高。

纯色填充变体：`...force_original_aspect_ratio=increase:flags=fast_bilinear,gblur=sigma=40,scale=...`

---

## 2. 去重 / 过原创（dedup）★★最核心的 IP

核心思路：**每条成片对下列滤镜各取一个随机值**，叠加后人眼几乎无感，但足以改变平台查重指纹。

### 2.1 噪点 + 亮度 + 暗角（招牌配方）**【完整】**
```bash
noise=alls=2:allf=t, eq=brightness=0.008, vignette=PI/30
```
- `noise=alls=2:allf=t` 每帧随机噪点（`allf=t` 时域，逐帧不同）
- `eq=brightness=0.008` 几乎不可见的亮度偏移
- `vignette=PI/30` 极轻暗角

### 2.2 翻转 / 旋转 **【完整】**
```bash
transpose=1,transpose=2,hflip,vflip,setpts=PTS-STARTPTS
```
（`transpose=1`顺时针90°，`=2`逆时针90°；按需单独取用 hflip/vflip）

### 2.3 微裁剪缩放（改变构图指纹）**【重建】**
```bash
crop=iw*{0.95~1.0}:ih*{0.95~1.0}, scale={W}:{H}
```

### 2.4 变速（视频+音频同步）**【重建】**
```bash
# 视频
setpts=PTS/{speed}
# 音频（atempo 单次 0.5~2.0，超范围需串联）
aresample=48000, atempo={speed}
```

### 2.5 画面微调（PictureAdjustParams，16 参数，全部带 min/max 随机区间）
二进制原样字段：
```
minSharpen/maxSharpen, minBrightness/maxBrightness, minDenoise/maxDenoise,
minColorTemp/maxColorTemp, minContrast/maxContrast, minSaturation/maxSaturation,
stylePrimary, styleVignette, styleFilmGrain, styleGlow
```
对应滤镜：`eq=brightness=:contrast=:saturation=`、`unsharp`(锐化)、`hqdn3d=`(去噪)、色温(`colortemperature` 或 `colorbalance`)、`vignette=`、`noise`(film grain)、glow(见 8.x)。

### 2.6 去噪（配合再加噪，洗掉原始压缩纹理）**【完整】**
```bash
dctdnoiz=sigma=4.0:overlap=0
hqdn3d=2:4:5:8
```

> **复刻关键**：把以上每项做成 `(min,max)` 配置，导出时对每条片 `rand(min,max)`。这就是"批量混剪 N 条互不相同"的实现本质——不是 AI，是参数随机化。

---

## 3. 转场（xfade）**【完整】**

```bash
xfade=transition={name}:duration={d}:offset={offset}
```
二进制内置全套 transition（来自 `attachments-Xfade/*.gif` 预览图 + 代码常量）：

```
fade fadeblack fadewhite fadegrays
wiperight wipeleft wipeup wipedown wipetl wipetr wipebl wipebr
slideleft slideright slideup slidedown
smoothleft smoothright smoothup smoothdown
circlecrop circleclose circleopen rectcrop
horzclose horzopen vertclose vertopen
diagbl diagbr diagtl diagtr
hlslice hrslice vuslice vdslice hlwind hrwind vuwind vdwind
dissolve pixelize radial hblur distance zoomin
coverleft coverright coverup coverdown revealleft revealright revealup revealdown
squeezeh squeezev
```

短素材先补帧再转场 **【重建】**：
```bash
[v]tpad=stop_mode=clone:stop_duration={d}[padded];   # 克隆末帧延长
# 或黑场过渡：
g[still0];[still0]drawbox=x=0:y=0:w=iw:h=ih:color=black@1:t=fill[still];
[still][main]xfade=transition={name}:duration={d}:offset={o}
```

---

## 4. 拼接（concat）

两种方式都用到：

```bash
# A. filter 内拼接（需先统一分辨率/SAR/tb）
[v0][a0][v1][a1]...concat=n={N}:v=1:a=1[outv][outa]

# B. demuxer 拼接（更快，先各自转成 .ts）
#   写 concat_list.txt → ffmpeg -f concat -safe 0 -i concat_list.txt -c copy merged.ts
```
（二进制证据：`concat=n=`、`concat_list.txt`、`merged.ts`、`ecutauto_lib::ffmpeg::concat`、`src/ffmpeg/concat.rs`）

---

## 5. 水印

### 5.1 图片水印 **【重建】**
```bash
[wm_raw]format=rgba[wm];
[wm]scale={w}:{h}[wm_s];
[wm_s]colorchannelmixer=aa={opacity}[wm_a];           # 透明度
[IN_V][wm_a]overlay='{x}':'{y}':shortest=1:eof_action=repeat
```

### 5.2 文字水印（drawtext，TextWatermarkConfig 16 字段）
字段含 `font_family/font_size/font_weight/outline_color/outline_width/glow_color/shadow_depth/shadow_color/second_outline_color/style_type/opacity` 等。

### 5.3 闪现水印（间歇出现，规避帧级检测）**【完整片段】**
```bash
[IN_V][wm]overlay=...:enable='between(mod(t,{周期}),{start},{end})'
```

### 5.4 贴纸叠加 + 黑底自动抠像（亮度键控）**【完整】**
```bash
[stk_raw][IN_V]scale2ref=flags=lanczos+accurate_rnd+full_chroma_int[stk_scaled][IN_V];
[stk_scaled]hqdn3d=2:4:5:8[stk_denoised];
[stk_denoised]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y),8),0,0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))',format=yuva444p[stk_keyed];
[stk_keyed]colorchannelmixer=aa={opacity}[stk_alpha];
[IN_V][stk_alpha]overlay='main_w*{x}':'main_h*{y}'
```
（按 BT.709 亮度 <8 的像素转全透明 = 抠掉黑背景）

---

## 6. 去水印（delogo）

```bash
delogo=x={x}:y={y}:w={w}:h={h}                          # 绝对坐标
delogo=x='floor(iw*{rx})':y='floor(ih*{ry})':w=...:h=... # 相对坐标
```
链式：先去水印再运镜 → `[vdelogo][vzoompan]`，失败回退 `[vdelogo_fb]`。
区域由 `DelogoRegion{x,y,w,h}` / `RemoveWatermarkConfig`（可多区域）给出，AI 视觉模型可自动框选。

---

## 7. 运镜 / 缩放（Ken Burns, zoompan）

```bash
zoompan=z='{zoom_expr}':d={帧数}:fps={fps}:x='{x_expr}':y='{y_expr}':s={W}x{H}
```
ZoomPanParams（5–6 字段）控制起止缩放与平移方向。

---

## 8. 像素 / 风格滤镜（LUT & creative effects）**【完整】**

源模块：`ecutauto_lib::modules::creative::video_effects::effects::lut_filter`

```bash
# 马赛克/像素化
scale=iw/12:ih/12:flags=neighbor, scale=iw*12:ih*12:flags=neighbor
# 锐化（卷积核）
convolution=-2 -1 0 -1 1 1 0 1 2:...:1:1:1:1:96:0:0:0
# 暗化
eq=brightness=-0.32
# 边缘检测
edgedetect=mode=colormix:high=0
# 调色预设
curves=cross_process
curves=vintage
# 其它风格关键字：grayscale / vintage / cross_process / cartoon / emboss / sobel / glow
```

辉光（glow blend）**【完整片段】**：
```bash
[IN_V]split[gl_a][gl_b];
[gl_b]gblur=sigma={s}[gl_blur];
[gl_a][gl_blur]blend=all_mode=glow:all_opacity={o}
```

---

## 9. 画中画（PiP）

PipParams（10 字段）。用 `scale2ref` 让前景按主画面缩放后 `overlay` 到指定位置，支持像素混合：
```bash
[fg]format=rgb24[ins_fmt];[ins_fmt]scale=...[ins_src];
[IN_V]format=rgb24[base];[base][ins_src]blend=all_expr='A*{a}+B*{b}'   # 像素混合模式
```

---

## 10. 音频处理链 **【完整片段拼合】**

```bash
# 统一格式
aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo
# 变速 / 变调
atempo={tempo}                       # 速度（不变调）
aresample=48000,asetrate=48000*{r}   # 变调（minPitchCents/maxPitchCents）
# 淡入淡出
afade=t=in:st=0:d={d}
afade=t=out:st={start}:d={d}
# 均衡器
equalizer=f=1000:t=h:width=200:g={gain}
# 混音（原声 + BGM）
[main_a][bgm]amix=inputs=2:normalize=0:duration=first[audio_result]
# 音量
volume={v}
```
AudioSettingsParams 字段：`minVolume/maxVolume, enableFade, intelligentAdjust, backgroundMusic, minBackgroundVolume/maxBackgroundVolume, backgroundLoop, backgroundFade, minPitchCents/maxPitchCents, minNoiseLevel/maxNoiseLevel, minEqGainDb/maxEqGainDb`（同样全是随机区间）。

---

## 11. 封面 / 片头

```bash
# 生成纯黑引导帧（去重：片头插一小段）
ffmpeg -f lavfi -i color=c=black:s=256x256:d=0.2 ...
# 封面叠加（仅前 N 秒显示）
[IN_V][cover_scaled]overlay=0:0:enable='between(t,0,{sec})'
# 冻结首帧做静态封面
[v]select=eq(n\,0),loop=loop=-1:size=1:start=0,trim=duration={d}
```

---

## 12. 编码输出参数

```bash
# 视频编码（软编 / N卡硬编自动切换）
-c:v libx264                       # 或 h264_nvenc -preset p1（speed-preset）
# 缩放 + 帧率 + faststart
scale='min(854,iw)':-2, fps={fps}
-movflags +faststart
# 音频
-c:a aac -b:a 32k                  # 或 -c:a copy
# 色彩
format=yuv420p, setparams=colorspace=bt709:color_trc=bt709:color_primaries=bt709
```

输出/分组配置字段（来自 ProcessingOptions / ExportRequest）：
`Fps120, PrefixIndex, SuffixIndex, SmartSingle, Mkv, delete_original, thread_count, naming_rule, output_fps, crop_params, fission_count`

---

## 附：AI 模型的视频预处理（喂给 ONNX）

```bash
# 抽帧 + 缩放到模型输入尺寸（场景检测 TransNetV2 / 视觉编码器）
-frames:v ... scale=224:224, setsar=1        # CLIP 类输入
# 缩略图采样
fps={采样fps}, scale=...
```

---

### 复刻落地建议
1. 把第 1/3/5/8/10 节做成**模板函数**，参数化 `{}` 占位即可覆盖 80% 功能。
2. 去重（第 2 节）单独做一个 `DedupParams { 每项: (min,max) }`，导出每条片时随机采样——这是"批量出 N 条不同成片"的真正实现。
3. 编码统一走第 12 节的尾参，避免平台二次转码导致画质损失/被识别。
