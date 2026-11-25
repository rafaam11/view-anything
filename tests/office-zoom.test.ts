// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { officeStatusBar, scaleToSlider, sliderToScale } from "../src/office/zoom";

test("the slider is 10% at the left, 100% in the middle and 400% at the right, both ways", () => {
  expect([0, 50, 100].map(sliderToScale)).toEqual([0.1, 1, 4]);
  for (const scale of [0.1, 0.25, 0.73, 1, 1.5, 4]) expect(sliderToScale(scaleToSlider(scale))).toBeCloseTo(scale, 10);
});

test("the status bar zooms by buttons, slider (snapping to 100%), percentage and fit", () => {
  const area = document.createElement("div");
  const applied: number[] = [];
  const bar = officeStatusBar(area, s => applied.push(s), () => 0.5);
  document.body.append(bar.element);
  bar.zoom.fit();
  expect(applied.at(-1)).toBe(0.5);
  const slider = bar.element.querySelector<HTMLInputElement>("input[type=range]")!;
  slider.value = "51"; slider.dispatchEvent(new Event("input"));
  expect(applied.at(-1)).toBe(1);
  slider.value = "75"; slider.dispatchEvent(new Event("input"));
  expect(applied.at(-1)).toBe(2.5);
  expect(bar.element.querySelector(".office-zoom")!.textContent).toBe("250%");
  bar.element.querySelector<HTMLButtonElement>(".office-zoom")!.click();
  expect(applied.at(-1)).toBe(1);
  bar.element.querySelector<HTMLButtonElement>('[aria-label="축소"]')!.click();
  expect(applied.at(-1)).toBe(0.8);
  bar.zoom.refit(); // not fitted any more: stays
  expect(applied.at(-1)).toBe(0.8);
  bar.info(["슬라이드 1/2", "", "읽기 전용"]);
  expect(bar.element.querySelector("[role=status]")!.textContent).toBe("슬라이드 1/2   읽기 전용");
});
