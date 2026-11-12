import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_SEC, TAIL_SEC, isLayout, muxArgs, planMux } from "../ffmpeg.mjs";

test("narration longer than the video holds the last frame", () => {
  assert.deepEqual(planMux(10, 14), { target: 14 + TAIL_SEC, hold: 4 + TAIL_SEC });
});

test("narration shorter than the video keeps the video's length", () => {
  assert.deepEqual(planMux(12, 8), { target: 12, hold: 0 });
});

test("never shorter than Instagram's 3 s minimum", () => {
  assert.deepEqual(planMux(1.5, 1), { target: MIN_SEC, hold: MIN_SEC - 1.5 });
});

test("ffmpeg args: tpad only when holding, Reels-safe codecs, faststart", () => {
  const held = muxArgs({ video: "v", audio: "a", out: "o.mp4", videoSec: 10, audioSec: 14 });
  const graph = held[held.indexOf("-filter_complex") + 1];
  assert.match(graph, /tpad=stop_mode=clone:stop_duration=4\.6/);
  assert.match(graph, /apad/);
  assert.equal(held[held.indexOf("-t") + 1], "14.6");
  for (const [flag, value] of [
    ["-c:v", "libx264"],
    ["-pix_fmt", "yuv420p"],
    ["-c:a", "aac"],
    ["-ar", "48000"],
    ["-movflags", "+faststart"],
  ]) {
    assert.equal(held[held.indexOf(flag) + 1], value, flag);
  }
  assert.equal(held.at(-1), "o.mp4");

  const short = muxArgs({ video: "v", audio: "a", out: "o.mp4", videoSec: 12, audioSec: 8 });
  assert.doesNotMatch(short[short.indexOf("-filter_complex") + 1], /tpad/);
  assert.equal(short[short.indexOf("-t") + 1], "12");
});

test("layouts", () => {
  assert.ok(isLayout("source"));
  assert.ok(isLayout("vertical"));
  assert.ok(!isLayout("toString"));
  const vertical = muxArgs({ video: "v", audio: "a", out: "o", videoSec: 5, audioSec: 4, layout: "vertical" });
  assert.match(vertical[vertical.indexOf("-filter_complex") + 1], /pad=w=1080:h=1920/);
});
