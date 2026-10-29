import { expect, test } from "vitest";
import { ImageHistory, transformImage, type ImageState } from "../src/image/history";

const pixel = (s: ImageState, x: number, y: number) => {
  const [a,b,c,d,e,f] = s.matrix; return [a*x+c*y+e, b*x+d*y+f];
};
test("crop, rotation and flip compose without bringing back cropped pixels", () => {
  const h = new ImageHistory(8,6);
  const crop = transformImage(h.state,{kind:"crop",x:2,y:1,width:4,height:3});
  const rotated = transformImage(crop,{kind:"rotate"});
  const flipped = transformImage(rotated,{kind:"flip"});
  expect([flipped.width,flipped.height]).toEqual([3,4]);
  expect(pixel(flipped,2,1)).toEqual([0,0]);
  expect(pixel(flipped,6,4)).toEqual([3,4]);
  expect(pixel(flipped,1,0)).toEqual([-1,-1]); // outside the canvas clip
});
test("orthogonal transforms retain the source geometry and reject invalid crops", () => {
  const h = new ImageHistory(8,6); let state = h.state;
  for(let i=0;i<4;i++) state=transformImage(state,{kind:"rotate"});
  // Normalize -0 from rotations for numeric comparison.
  expect(JSON.stringify(state)).toBe(JSON.stringify(h.state));
  expect(transformImage(transformImage(h.state,{kind:"flip"}),{kind:"flip"})).toEqual(h.state);
  expect(()=>transformImage(state,{kind:"crop",x:0,y:0,width:0,height:1})).toThrow();
  expect(()=>transformImage(state,{kind:"crop",x:0,y:.5,width:1,height:1})).toThrow();
});
test("history limits undo to 20 edits, discards redo branches and tracks saved revisions", () => {
  const h=new ImageHistory(8,6);
  for(let i=0;i<25;i++) h.commit(transformImage(h.state,{kind:"rotate"}));
  let undone=0; while(h.previous) {h.undo(); undone++;} expect(undone).toBe(20);
  h.markSaved(); expect(h.dirty).toBe(false);
  h.redo(); expect(h.dirty).toBe(true); h.undo(); expect(h.dirty).toBe(false);
  h.commit(transformImage(h.state,{kind:"flip"})); expect(h.next).toBeUndefined(); expect(h.dirty).toBe(true);
});
