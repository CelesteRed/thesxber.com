import { useEffect, useRef, useState } from "react";
import SxbertySprite from "./SxbertySprite";
import { getPetLifeToken, getPetPresence } from "./verity-pet.js";
import { getHopPose, HOP_DURATION_SECONDS } from "./sxberty-motion.js";
import lavaImage from "./assets/verity/lava-bucket.png";
import {
  PET_SIZE, ITEM_SIZE, ITEM_LIFETIME_MS, FOOD_CHANCE, LAVA_CHANCE, MAX_FOODS,
  clamp, crossedDragThreshold, samplePointer, getThrowVelocity, getSubsteps,
  overlaps, sweptCollision, fullyOutside, stepBody, classifyRelease, getFlightEvent,
  advanceSpawnClock, shouldSpawn, chooseEnabledFood,
} from "./sxberty-physics.js";
import "./sxberty-playground.css";

const absent = { state: "absent", progress: 0, face: null, token: null };
const readPresence = pet => pet ? getPetPresence(pet, Date.now()) : absent;
const pointOf = event => ({ x: event.clientX, y: event.clientY });
let nextId = 0;
const uniqueId = () => `sx-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++nextId}-${Math.random().toString(36).slice(2, 9)}`}`;
const imageUrl = (url, apiBase) => url?.startsWith("/") ? `${(apiBase || "").replace(/\/$/, "")}${url}` : url;

/** Imperative positions live for the lifetime of the mounted scene, not a pet update. */
export default function SxbertyPlayground({ pet, foods = [], apiBase = "", speech, onOpen, onEvent, blocked = false, reduced = false }) {
  const latest = useRef(null);
  latest.current = { pet, foods, apiBase, speech, onOpen, onEvent, blocked, reduced };
  const root = useRef(null);
  const petNode = useRef(null);
  const rotation = useRef(null);
  const sprite = useRef(null);
  const shadow = useRef(null);
  const bubble = useRef(null);
  const controller = useRef(null);
  const [items, setItems] = useState([]);
  const [presentation, setPresentation] = useState(() => {
    const presence = readPresence(pet);
    return { state: presence.state, face: presence.face };
  });

  useEffect(() => {
    let alive = true;
    let frame = 0;
    let previous = null;
    let paused = true;
    let life = null;
    let generation = null;
    let presence = absent;
    let signature = "";
    let drag = null;
    let hovered = false;
    let focused = false;
    let elapsed = 0;
    let foodClock = 0;
    let lavaClock = 0;
    let activeTime = 0;
    let direction = 1;
    let angle = 0;
    let pose = getHopPose(0);
    let viewport = { width: window.innerWidth, height: window.innerHeight, floor: window.innerHeight - 18 };
    const objects = new Map();
    const pending = new Set();
    const suppressedClicks = new Map();
    const buddy = { id: "pet", kind: "pet", x: 92, y: viewport.floor - PET_SIZE, width: PET_SIZE, height: PET_SIZE, vx: 0, vy: 0, mode: "rest", flight: null, pending: false };
    const getBody = id => id === "pet" ? buddy : objects.get(id);
    const nodeFor = body => body.kind === "pet" ? petNode.current : body.node;
    const publishItems = () => { if (alive) setItems([...objects.values()]); };
    const interactive = () => alive && !document.hidden && !latest.current.blocked && latest.current.pet && !latest.current.pet.hidden;
    const playable = () => interactive() && presence.state === "present" && latest.current.pet?.stage === "alive";
    const currentToken = () => latest.current.pet ? getPetLifeToken(latest.current.pet) : null;
    const valid = token => alive && token === life && token === currentToken();
    const safeX = () => Math.max(0, (viewport.width - PET_SIZE) / 2);
    const resetBuddy = (center = false) => {
      buddy.x = center ? safeX() : clamp(buddy.x, 8, Math.max(8, viewport.width - PET_SIZE - 8));
      buddy.y = viewport.floor - PET_SIZE;
      buddy.vx = 0; buddy.vy = 0; buddy.mode = "rest"; buddy.flight = null; buddy.pending = false;
      pose = getHopPose(0); angle = 0;
    };
    const releaseCapture = gesture => {
      try {
        if (gesture?.node?.hasPointerCapture(gesture.pointerId)) gesture.node.releasePointerCapture(gesture.pointerId);
      } catch { /* The target may have been removed by a life transition. */ }
    };
    const cancelDrag = () => {
      const gesture = drag;
      if (!gesture) return;
      drag = null;
      suppressedClicks.set(gesture.body.id, performance.now() + 1000);
      releaseCapture(gesture);
      const body = gesture.body;
      body.flight = null; body.vx = 0; body.vy = 0; body.mode = "rest";
      body.x = clamp(body.x, 0, Math.max(0, viewport.width - body.width));
      body.y = viewport.floor - body.height;
      pose = getHopPose(0); angle = 0;
    };
    const removeItem = id => {
      const body = objects.get(id);
      if (!body) return;
      if (drag?.body === body) cancelDrag();
      const restoreFocus = document.activeElement === body.node;
      objects.delete(id);
      suppressedClicks.delete(id);
      publishItems();
      if (restoreFocus && interactive() && presence.state === "present") petNode.current?.focus({ preventScroll: true });
    };
    const clearItems = () => {
      if (drag?.body.kind !== "pet") cancelDrag();
      if (objects.size) {
        for (const id of objects.keys()) suppressedClicks.delete(id);
        objects.clear(); publishItems();
      }
      foodClock = 0; lavaClock = 0;
    };
    const collisionPet = () => ({ ...buddy, y: buddy.drawY ?? buddy.y });
    const findLava = (before = buddy, after = buddy) => [...objects.values()].find(item => item.kind === "lava" && !item.pending && sweptCollision(before, after, item, 8));

    // Invoke immediately, once; never queue a late callback after a scene unmount.
    const request = (event, done) => {
      if (!valid(event.token) || pending.has(event.id) || !interactive()) return false;
      pending.add(event.id);
      let result;
      try { result = latest.current.onEvent?.(event); } catch { result = false; }
      Promise.resolve(result).then(accepted => {
        pending.delete(event.id);
        if (valid(event.token)) done(accepted === true);
      }, () => {
        pending.delete(event.id);
        if (valid(event.token)) done(false);
      });
      return true;
    };
    const finishFlight = (type, lava) => {
      const flight = buddy.flight;
      if (!flight || !valid(flight.token)) { buddy.flight = null; return; }
      buddy.flight = null;
      buddy.mode = "rest";
      buddy.vx = 0; buddy.vy = 0;
      if (!type) return;
      const lethal = type === "offscreen" || type === "lava";
      buddy.pending = lethal;
      if (lava) lava.pending = true;
      const started = request({ id: flight.id, token: flight.token, type }, accepted => {
        if (accepted && lava) removeItem(lava.id);
        if (!accepted) {
          if (lava && objects.has(lava.id)) lava.pending = false;
          if (lethal) resetBuddy(true);
        }
        paint();
      });
      if (!started) {
        if (lava) lava.pending = false;
        if (lethal) resetBuddy(true);
      }
    };
    const feed = (body, token, id = uniqueId()) => {
      if (!body || body.kind !== "food" || body.pending || !playable() || !valid(token) || !objects.has(body.id)) return;
      body.pending = true; body.mode = "rest"; body.manual = false; body.vx = 0; body.vy = 0;
      const started = request({ id, token, type: "food", foodId: body.food.id }, accepted => {
        if (!objects.has(body.id)) return;
        if (accepted) removeItem(body.id);
        else {
          body.pending = false;
          body.y = viewport.floor - body.height;
        }
        paint();
      });
      if (!started) body.pending = false;
      paint();
    };

    function syncPresence() {
      const props = latest.current;
      const nextLife = currentToken();
      const next = readPresence(props.pet);
      if (nextLife !== life || props.pet?.generation !== generation) {
        cancelDrag();
        clearItems();
        life = nextLife;
        generation = props.pet?.generation;
        pending.clear();
        activeTime = 0; elapsed = 0;
        resetBuddy(true);
      }
      if (next.state !== presence.state && next.state !== "present") {
        cancelDrag();
        clearItems();
        resetBuddy(true);
      }
      if (presence.state === "falling" && next.state === "present") resetBuddy(true);
      presence = next;
      const nextSignature = `${presence.state}:${presence.face || ""}`;
      if (signature !== nextSignature) {
        signature = nextSignature;
        if (alive) setPresentation({ state: presence.state, face: presence.face });
      }
      if (props.pet?.stage !== "alive" || presence.state !== "present") clearItems();
      if (props.reduced) for (const item of objects.values()) {
        if (item.mode === "spawn") { item.mode = "rest"; item.y = viewport.floor - item.height; item.vy = 0; }
      }
      if (presence.state === "falling") {
        buddy.x = safeX();
        const progress = clamp(presence.progress || 0, 0, 1);
        buddy.y = props.reduced ? viewport.floor - PET_SIZE : -PET_SIZE + viewport.floor * progress * progress;
        pose = getHopPose(0); angle = 0;
      }
    }

    function paint() {
      const node = petNode.current;
      if (!node) return;
      const show = presence.state !== "absent" && Boolean(latest.current.pet) && !buddy.pending;
      const elevation = buddy.mode === "rest" && presence.state === "present" && !drag ? pose.height : 0;
      buddy.drawY = buddy.y - elevation;
      node.style.visibility = show ? "visible" : "hidden";
      node.style.transform = `translate3d(${buddy.x}px, ${buddy.drawY}px, 0)`;
      node.dataset.dragging = String(drag?.body === buddy && drag.dragged);
      node.style.pointerEvents = presence.state === "present" && !buddy.pending ? "auto" : "none";
      rotation.current.style.transform = `rotate(${angle}deg)`;
      sprite.current.style.transform = `scale(${pose.scaleX}, ${pose.scaleY})`;
      const height = Math.max(0, viewport.floor - PET_SIZE - buddy.drawY);
      const bodyHeight = Math.max(0, viewport.floor - PET_SIZE - buddy.y);
      shadow.current.style.transform = `translateY(${height}px) scale(${pose.shadowScale * clamp(1 - bodyHeight / 160, 0.2, 1)})`;
      shadow.current.style.opacity = String(pose.shadowOpacity * clamp(1 - bodyHeight / 220, 0.15, 1));
      for (const item of objects.values()) {
        if (!item.node) continue;
        item.node.style.visibility = "visible";
        item.node.style.transform = `translate3d(${item.x}px, ${item.y}px, 0)`;
        item.node.dataset.dragging = String(drag?.body === item && drag.dragged);
        item.node.dataset.pending = String(item.pending);
        item.node.disabled = item.pending || presence.state !== "present";
      }
      const label = bubble.current;
      if (label) {
        // The narrow, vertical HUD always owns its left-hand strip.
        const hudRight = document.querySelector(".sxberty-hud")?.getBoundingClientRect().right || 0;
        const left = Math.min(Math.max(8, hudRight + 12), Math.max(8, viewport.width - 48));
        label.style.maxWidth = `${Math.max(1, Math.min(250, viewport.width - left - 8))}px`;
        const width = label.offsetWidth;
        label.style.left = `${clamp(buddy.x + PET_SIZE / 2, left + width / 2, Math.max(left + width / 2, viewport.width - width / 2 - 8))}px`;
        label.style.top = `${clamp(buddy.drawY - label.offsetHeight - 18, 8, Math.max(8, viewport.height - label.offsetHeight - 8))}px`;
        label.style.visibility = show ? "visible" : "hidden";
      }
    }

    const spawn = (kind, food = null) => {
      const body = {
        id: uniqueId(), kind, food, width: ITEM_SIZE, height: ITEM_SIZE,
        x: 8 + Math.random() * Math.max(0, viewport.width - ITEM_SIZE - 16),
        y: latest.current.reduced ? viewport.floor - ITEM_SIZE : -ITEM_SIZE,
        vx: 0, vy: 0, mode: latest.current.reduced ? "rest" : "spawn",
        born: activeTime, pending: false, manual: false, token: life,
      };
      objects.set(body.id, body);
      publishItems();
    };
    const advanceItems = (seconds) => {
      for (const item of objects.values()) {
        if (item.pending || drag?.body === item || item.mode === "rest") continue;
        const before = { ...item };
        const moved = stepBody(item, seconds, viewport);
        Object.assign(item, moved.body);
        // Fresh items start above the viewport; only a deliberate release can discard one.
        if (item.manual && fullyOutside(item, viewport)) { removeItem(item.id); continue; }
        if (item.kind === "food" && item.manual && playable() && !buddy.pending && sweptCollision(before, item, collisionPet(), 7)) {
          feed(item, item.token, item.gestureId);
        } else if (moved.settled) {
          item.mode = "rest";
          item.manual = false;
        }
      }
    };
    const advanceBuddy = seconds => {
      if (presence.state !== "present" || buddy.pending || drag?.body === buddy) return;
      if (buddy.mode === "flight") {
        const before = { ...buddy };
        const moved = stepBody(buddy, seconds, viewport);
        Object.assign(buddy, moved.body);
        const outside = fullyOutside(buddy, viewport);
        const lava = outside ? null : findLava(before, buddy);
        const type = getFlightEvent({ thrown: buddy.flight?.thrown, settled: moved.settled, outside, lava: Boolean(lava) });
        angle += buddy.vx * seconds * 0.12;
        if (type || moved.settled) { finishFlight(type, lava); pose = getHopPose(0); angle = 0; }
        return;
      }
      if (latest.current.reduced || latest.current.pet?.paused || latest.current.pet?.sleeping || hovered || focused || drag) {
        pose = getHopPose(0); angle = 0;
        return;
      }
      elapsed += seconds;
      const walking = HOP_DURATION_SECONDS * 6;
      const cycle = elapsed % (walking + 6);
      const rolling = cycle >= walking && cycle < walking + 3;
      const moving = cycle < walking + 3;
      const distance = moving ? seconds * (rolling ? 90 : 42) * direction : 0;
      buddy.x += distance;
      const right = Math.max(8, viewport.width - PET_SIZE - 8);
      if (buddy.x <= 8 || buddy.x >= right) { buddy.x = clamp(buddy.x, 8, right); direction *= -1; }
      buddy.y = viewport.floor - PET_SIZE;
      angle = rolling ? angle + distance * 3 : 0;
      pose = moving && !rolling ? getHopPose(cycle) : getHopPose(0);
    };
    const tick = time => {
      frame = 0;
      if (!alive || !interactive()) { paused = true; previous = null; return; }
      syncPresence();
      const deltaMs = previous === null ? 0 : Math.max(0, time - previous);
      const steps = getSubsteps(deltaMs);
      previous = time;
      // Pausing only stops automatic pet roaming; it must not stop food supply.
      const active = playable();
      if (active) {
        activeTime += deltaMs;
        for (const item of objects.values()) {
          if (!item.pending && drag?.body !== item && activeTime - item.born >= ITEM_LIFETIME_MS) removeItem(item.id);
        }
        const foodTick = advanceSpawnClock(foodClock, deltaMs);
        const lavaTick = advanceSpawnClock(lavaClock, deltaMs);
        foodClock = foodTick.elapsedMs; lavaClock = lavaTick.elapsedMs;
        if (foodTick.due && shouldSpawn(FOOD_CHANCE, [...objects.values()].filter(item => item.kind === "food").length, MAX_FOODS)) {
          const food = chooseEnabledFood(latest.current.foods);
          if (food) spawn("food", food);
        }
        if (lavaTick.due && shouldSpawn(LAVA_CHANCE, [...objects.values()].filter(item => item.kind === "lava").length, 1)) spawn("lava");
      }
      for (const seconds of steps) { advanceItems(seconds); advanceBuddy(seconds); }
      paint();
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (!alive) return;
      syncPresence();
      const pause = !interactive();
      if (pause !== paused) {
        previous = null;
        if (drag) drag.samples = [];
      }
      paused = pause;
      if (paused) { cancelAnimationFrame(frame); frame = 0; }
      else if (!frame) frame = requestAnimationFrame(tick);
      paint();
    };
    const resize = () => {
      const rect = root.current?.getBoundingClientRect();
      const bottom = parseFloat(getComputedStyle(root.current).paddingBottom) || 18;
      viewport = { width: rect?.width || window.innerWidth, height: rect?.height || window.innerHeight, floor: (rect?.height || window.innerHeight) - bottom };
      if (!drag && !buddy.pending && buddy.mode === "rest" && presence.state === "present") resetBuddy();
      for (const item of objects.values()) if (item.mode === "rest" && drag?.body !== item) {
        item.x = clamp(item.x, 0, Math.max(0, viewport.width - item.width));
        item.y = viewport.floor - item.height;
      }
      sync();
    };

    const pointerDown = (id, event) => {
      syncPresence();
      const body = getBody(id);
      if (!body || drag || body.pending || !playable() || event.button !== 0 || event.isPrimary === false) return;
      if (body === buddy && buddy.flight) finishFlight(getFlightEvent({ thrown: buddy.flight.thrown, caught: true }));
      const point = pointOf(event);
      const now = performance.now();
      const node = event.currentTarget;
      drag = {
        body, node, pointerId: event.pointerId, start: point, last: point,
        offsetX: point.x - body.x, offsetY: point.y - (body === buddy ? buddy.drawY ?? body.y : body.y),
        samples: samplePointer([], point, now), dragged: false, token: life, id: uniqueId(),
      };
      if (body === buddy) body.y = buddy.drawY ?? body.y;
      body.mode = "held";
      body.vx = 0; body.vy = 0;
      try { node.setPointerCapture(event.pointerId); } catch { cancelDrag(); }
      paint();
    };
    const pointerMove = event => {
      if (!drag || event.pointerId !== drag.pointerId || !interactive()) return;
      if (!valid(drag.token)) { cancelDrag(); return; }
      const point = pointOf(event);
      drag.last = point;
      drag.samples = samplePointer(drag.samples, point, performance.now());
      if (!drag.dragged && crossedDragThreshold(drag.start, point)) drag.dragged = true;
      if (!drag.dragged) return;
      event.preventDefault();
      drag.body.x = point.x - drag.offsetX;
      drag.body.y = point.y - drag.offsetY;
      if (drag.body === buddy) { pose = getHopPose(0); angle = 0; }
      paint();
    };
    const pointerUp = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!interactive() || !valid(drag.token)) { cancelDrag(); paint(); return; }
      pointerMove(event);
      const gesture = drag;
      const body = gesture.body;
      drag = null;
      releaseCapture(gesture);
      if (!gesture.dragged) {
        body.mode = "rest";
        body.y = viewport.floor - body.height;
        paint();
        return;
      }
      event.preventDefault();
      suppressedClicks.set(body.id, performance.now() + 1000);
      const now = performance.now();
      const samples = samplePointer(gesture.samples, pointOf(event), now);
      const velocity = getThrowVelocity(samples, now);
      const outside = fullyOutside(body, viewport);
      const lava = body === buddy && !outside ? findLava() : null;
      const outcome = classifyRelease({ dragged: true, velocity, outside, lava: Boolean(lava) });
      body.vx = outcome === "throw" ? velocity.vx : 0;
      body.vy = outcome === "throw" ? velocity.vy : 0;
      body.mode = "flight";
      if (body === buddy) {
        buddy.flight = { id: gesture.id, token: gesture.token, thrown: outcome === "throw" };
        if (outcome === "offscreen" || outcome === "lava") finishFlight(outcome, lava);
      } else if (outside) removeItem(body.id);
      else {
        body.manual = true; body.token = gesture.token; body.gestureId = gesture.id;
        if (body.kind === "food" && overlaps(body, collisionPet(), 7)) feed(body, gesture.token, gesture.id);
      }
      paint();
    };
    const pointerCancel = event => {
      if (drag?.pointerId === event.pointerId) { cancelDrag(); paint(); }
    };
    const activate = (id, event) => {
      const suppressed = suppressedClicks.get(id);
      suppressedClicks.delete(id);
      if (event.detail !== 0 && suppressed && suppressed >= performance.now()) { event.preventDefault(); return; }
      syncPresence();
      if (!interactive() || presence.state !== "present") return;
      if (id === "pet") latest.current.onOpen?.(event);
      else feed(objects.get(id), life);
    };
    const keyDown = (id, event) => {
      if (event.key === "Escape" && drag?.body.id === id) { event.preventDefault(); cancelDrag(); paint(); }
      if ((event.key === "Delete" || event.key === "Backspace") && id !== "pet" && interactive()) {
        event.preventDefault();
        if (!objects.get(id)?.pending) removeItem(id);
      }
    };
    controller.current = {
      sync, pointerDown, pointerMove, pointerUp, pointerCancel, activate, keyDown,
      hover: value => { hovered = value; }, focus: value => { focused = value; },
    };
    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      const gesture = drag; drag = null; releaseCapture(gesture);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", sync);
      objects.clear(); pending.clear(); suppressedClicks.clear();
      controller.current = null;
    };
  }, []);

  // Reconcile current props without destroying pointer capture, timers, or velocities.
  useEffect(() => { controller.current?.sync(); });
  const handlers = id => ({
    onPointerDown: event => controller.current?.pointerDown(id, event),
    onPointerMove: event => controller.current?.pointerMove(event),
    onPointerUp: event => controller.current?.pointerUp(event),
    onPointerCancel: event => controller.current?.pointerCancel(event),
    onLostPointerCapture: event => controller.current?.pointerCancel(event),
    onClick: event => controller.current?.activate(id, event),
    onKeyDown: event => controller.current?.keyDown(id, event),
    onDragStart: event => event.preventDefault(),
  });

  return <div ref={root} className="sxberty-world" hidden={!pet || pet.hidden || blocked} data-state={presentation.state} data-reduced={reduced}>
    {speech && presentation.state !== "absent" && <div ref={bubble} className="sxberty-world-bubble" role={speech.announce ? "status" : undefined}>{speech.text}</div>}
    <button ref={petNode} type="button" className="sxberty-world-pet sxberty-world-draggable" {...handlers("pet")}
      aria-label="Visit Sxberty. Drag to move or throw him." aria-haspopup="dialog" tabIndex={presentation.state === "present" ? 0 : -1}
      onPointerEnter={event => { if (event.pointerType !== "touch") controller.current?.hover(true); }}
      onPointerLeave={() => controller.current?.hover(false)}
      onFocus={() => controller.current?.focus(true)} onBlur={() => controller.current?.focus(false)}>
      <span ref={shadow} className="sxberty-world-shadow" aria-hidden="true" />
      <span ref={rotation} className="sxberty-world-rotation" aria-hidden="true">
        <SxbertySprite ref={sprite} happiness={pet?.happiness ?? 100} face={presentation.face} size={PET_SIZE} />
      </span>
      {pet?.sleeping && <span className="sxberty-sleep-label" aria-hidden="true">zzz</span>}
    </button>
    {pet && items.map(item => <button key={item.id} type="button" ref={node => { item.node = node; }}
      className={`sxberty-world-item sxberty-world-draggable sxberty-world-${item.kind}`} {...handlers(item.id)}
      data-item-id={item.id} data-food-id={item.food?.id}
      aria-label={item.kind === "food" ? `${item.food.name}. Press Enter to feed Sxberty, drag onto him, or press Delete to remove.` : "Lava bucket. Drag to move or throw away; press Delete to discard."}
      title={item.kind === "food" ? `${item.food.name} · Enter to feed · Delete to remove` : "Lava · Delete to discard"}>
      <img src={item.kind === "lava" ? lavaImage : imageUrl(item.food.url, apiBase)} alt="" draggable="false" />
    </button>)}
  </div>;
}
