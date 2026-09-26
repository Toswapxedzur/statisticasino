import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOKS, METALS, ownedLooks, isLook, ringSvg, ringBox, plateStyle, RAMPS } from "./cosmetics.js";

test("all eleven coin metals, in the coins' order, at rising milestones", () => {
  assert.deepEqual(LOOKS.map((l) => [l.key, l.at]), [["default", 0], ["copper", 12500], ["brass", 15e3], ["silver", 2e4], ["gold", 25e3], ["rose", 4e4], ["platinum", 6e4], ["ruby", 1e5], ["sapphire", 2.5e5], ["emerald", 1e6], ["obsidian", 5e6], ["riverstone", 2.5e7]]);
  assert.deepEqual(ownedLooks(0), ["default"]);
  assert.deepEqual(ownedLooks(10_000), ["default"], "the signup grant alone unlocks nothing");
  assert.deepEqual(ownedLooks(100_499), ["default", "copper", "brass", "silver", "gold", "rose", "platinum", "ruby"]);
  assert.deepEqual(ownedLooks(24_999), ["default", "copper", "brass", "silver"]);
  assert.ok(isLook("emerald") && isLook("copper") && !isLook("diamond"));
});

test("five shades per metal; the rhombuses always lighter than the band", () => {
  const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const m of METALS) {
    const { light, dark } = RAMPS[m.key];
    assert.equal(new Set([...light, ...dark]).size, 5, `${m.key}: five shades`);
    assert.ok(lum(light[1]) > lum(dark[1]), `${m.key}: rhombus lighter than band`);
  }
});

test("the ring: 65% band, no clip-path ids (so any number fit on one page), plates have legible ink", () => {
  const svg = ringSvg(28, "ruby");
  assert.equal(ringBox(28), Math.ceil(28 + 2 * (14 * 0.65 + 1.5)));
  assert.ok(!/id=|url\(#/.test(svg), "no ids");
  assert.ok((svg.match(/<polygon/g) || []).length >= 16, "rhombuses = pairs of triangles");
  assert.equal(plateStyle("gold").ink === "#ffffff", false, "dark ink on light gold");
  assert.equal(plateStyle("sapphire").ink, "#ffffff");
  assert.equal(plateStyle("nonsense").ink, plateStyle("default").ink);
});

test("the ring is the turn clock: its gems vanish one by one, the last one fading", () => {
  const gems = (svg) => (svg.match(/<polygon/g) || []).length / 2;
  const full = gems(ringSvg(36, "gold", 1));
  assert.equal(gems(ringSvg(36, "gold", 0)), 0, "time's up: no gems");
  const half = ringSvg(36, "gold", 0.5);
  assert.ok(Math.abs(gems(half) - full / 2) <= 1);
  const partial = ringSvg(36, "gold", (3.4) / full);          // three and a bit gems left
  assert.equal(gems(partial), 4);
  assert.match(partial, /<g opacity="0\.40">/, "the fourth is fading");
  assert.ok(ringSvg(36, "gold", 0.5).includes('fill-rule="evenodd"'), "the band itself always stays");
});
