function parseSrtTime(value) {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms.padEnd(3, "0")) / 1000;
}

export function parseSrt(text) {
  return String(text)
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timeIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeIndex < 0) return [];
      const [startRaw, endRaw] = lines[timeIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
      const start = parseSrtTime(startRaw);
      const end = parseSrtTime(endRaw);
      const textLines = lines.slice(timeIndex + 1).join("\n").trim();
      if (start === null || end === null || end <= start || !textLines) return [];
      return [{ start, end, text: textLines, confidence: 1 }];
    });
}

export function subtitleTextFromFrames(frames) {
  return frames.map((frame) => frame.text).join("\n").trim();
}
