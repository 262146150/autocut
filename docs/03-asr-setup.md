# Local ASR Setup

The Web MVP uses `whisper.cpp` as the first local ASR backend. The backend extracts 16 kHz mono WAV audio with FFmpeg, runs `whisper-cli`, parses the generated SRT, and burns the resulting subtitle frames with the existing subtitle style controls.

## Install whisper.cpp

On macOS with Homebrew:

```bash
brew install whisper-cpp
```

Verify:

```bash
whisper-cli --help
```

## Download a Model

Keep models outside source control. A small starter model is enough for MVP testing:

```bash
mkdir -p ~/.cache/ecutauto-clone/models/whisper
curl -L -o ~/.cache/ecutauto-clone/models/whisper/ggml-tiny-q5_1.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin
```

If Hugging Face is slow, use the mirror:

```bash
curl -L -o ~/.cache/ecutauto-clone/models/whisper/ggml-tiny-q5_1.bin \
  https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin
```

For better Chinese accuracy, replace it with a larger multilingual model such as `ggml-base.bin` or `ggml-small.bin`.

Download the VAD model as well. It prevents music, tone, and background audio from being hallucinated into subtitles:

```bash
curl -L -o ~/.cache/ecutauto-clone/models/whisper/ggml-silero-v6.2.0.bin \
  https://hf-mirror.com/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin
```

## Environment Variables

The backend auto-detects common Homebrew and cache paths. Override them when needed:

```bash
export ECUT_WHISPER_BIN=/opt/homebrew/bin/whisper-cli
export ECUT_WHISPER_MODEL=$HOME/.cache/ecutauto-clone/models/whisper/ggml-tiny-q5_1.bin
export ECUT_VAD_MODEL=$HOME/.cache/ecutauto-clone/models/whisper/ggml-silero-v6.2.0.bin
export ECUT_ASR_LANG=zh
```

Restart the backend after changing environment variables:

```bash
cd ecutauto-clone/web
node server.mjs
```

## Runtime Behavior

In custom mix mode, choose `视频字幕 -> 自动识别`. The backend first checks for a sidecar subtitle file next to each video:

- `clip.srt`: parsed as timed subtitle frames.
- `clip.txt`: burned as one full-length subtitle.

If no sidecar exists, it runs whisper.cpp and caches generated SRT files under `web/_cache/asr/`.
