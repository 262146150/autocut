// mix.mjs — 命令行入口（薄封装，核心在 pipeline.mjs）
// 用法:
//   node mix.mjs                          # 自动生成测试素材，出 3 条竖屏成片
//   node mix.mjs --canvas 1920x1080 --out 5 --inputs /path/to/clips
import path from "node:path";
import { runMix, makeTestClips, collectClips, rm } from "./pipeline.mjs";

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : d;
  };
  const [w, h] = get("--canvas", "1080x1920").split("x").map(Number);
  return { w, h, out: Number(get("--out", "3")), inputs: get("--inputs", null), fps: Number(get("--fps", "30")) };
}

async function main() {
  const { w, h, out, inputs, fps } = parseArgs();
  const root = path.resolve("./_run");
  const outDir = path.join(root, "output");
  const workDir = path.join(root, "work");
  await rm(root, { recursive: true, force: true });

  console.log(`画布: ${w}x${h}  出片: ${out} 条  fps: ${fps}`);
  const clips = inputs ? await collectClips(inputs) : await makeTestClips(path.join(workDir, "src"));
  console.log(`素材 ${clips.length} 个:`, clips.map((c) => path.basename(c)).join(", "));

  const results = await runMix({
    clips, w, h, out, fps, outDir, workDir,
    onEvent: (e) => {
      if (e.type === "segment") {
        const p = e.params;
        console.log(`  成片#${e.output} 段${e.seg}: flip=${p.hflip} bri=${p.brightness.toFixed(3)} ` +
          `sat=${p.saturation.toFixed(3)} noise=${p.noise} tempo=${p.tempo.toFixed(3)}`);
        if (e.filter) console.log(`    filter:\n    ${e.filter.replace(/;/g, ";\n    ")}`);
      } else if (e.type === "output_done") {
        console.log(`  ✓ ${e.path}`);
      }
    },
  });
  console.log(`\n完成：${results.length} 条成片于 ${outDir}`);
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
