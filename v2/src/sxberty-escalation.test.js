import test from "node:test";
import assert from "node:assert/strict";
import { getEscalationPose } from "./sxberty-escalation.js";
import { COUNTDOWN_MS } from "./verity-pet.js";

test("zero-happiness growth is discrete over ten seconds", () => {
  assert.equal(COUNTDOWN_MS, 10000);
  assert.equal(getEscalationPose(100,100).scale,1);
  assert.deepEqual(getEscalationPose(100,900),getEscalationPose(100,100));
  assert.equal(getEscalationPose(100,1100).step,1);
  assert.equal(getEscalationPose(100,3100).centerMix,1);
  for(let i=0;i<9;i++)assert.ok(getEscalationPose(0,(i+1)*1000).scale>getEscalationPose(0,i*1000).scale);
});
test("the final three growth jumps are larger than early changes", () => {
  const sizes=Array.from({length:10},(_,i)=>getEscalationPose(0,i*1000).scale);
  const early=Math.max(...sizes.slice(1,7).map((size,i)=>size-sizes[i]));
  for(let i=7;i<10;i++)assert.ok(sizes[i]-sizes[i-1]>early);
});
test("growth bounds old and invalid clocks without runaway scale", () => {
  assert.deepEqual(getEscalationPose(100,0),getEscalationPose(0,0));
  assert.deepEqual(getEscalationPose(NaN,Infinity),getEscalationPose(0,0));
  const overdue=getEscalationPose(0,999999);
  assert.equal(overdue.step,9);assert.equal(overdue.scale,4.6);assert.equal(overdue.centerMix,1);
});
