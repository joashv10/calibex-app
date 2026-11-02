import { test } from "node:test";
import assert from "node:assert/strict";
import { weightLabel } from "../lib/weightLabel.ts";

test("two-dumbbell moves ask for the total; one-arm and other kit stay plain kg", () => {
  assert.equal(weightLabel({ name: "Incline Dumbbell Press", eq: "dumbbell" }), "kg total");
  assert.equal(weightLabel({ name: "Side Lateral Raise", eq: "dumbbell" }), "kg total");
  assert.equal(weightLabel({ name: "One-Arm Dumbbell Row", eq: "dumbbell" }), "kg");
  assert.equal(weightLabel({ name: "One Arm Dumbbell Preacher Curl", eq: "dumbbell" }), "kg");
  assert.equal(weightLabel({ name: "Dumbbell Seated One-Leg Calf Raise", eq: "dumbbell" }), "kg");
  assert.equal(weightLabel({ name: "Concentration Curls", eq: "dumbbell" }), "kg");
  assert.equal(weightLabel({ name: "Tricep Dumbbell Kickback", eq: "dumbbell" }), "kg");
  assert.equal(weightLabel({ name: "External Rotation", eq: "dumbbell" }), "kg");
  // one dumbbell in both hands: the total is that dumbbell
  assert.equal(weightLabel({ name: "Straight-Arm Dumbbell Pullover", eq: "dumbbell" }), "kg total");
  assert.equal(weightLabel({ name: "Barbell Bench Press - Medium Grip", eq: "barbell" }), "kg");
  assert.equal(weightLabel({ name: "Custom lift", eq: null }), "kg");
});
