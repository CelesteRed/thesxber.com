import { markdownToHtml } from "./markdown.js";

const random = (min, max) => min + Math.random() * (max - min);
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function throwVelocity(points) {
  const end = points.at(-1);
  const start = points.find(point => point.time >= (end?.time || 0) - 80);
  if (!start || end.time <= start.time) return { x: 0, y: 0 };
  const scale = 16.67 * 0.4 / (end.time - start.time);
  return { x: clamp((end.x - start.x) * scale, -12, 12), y: clamp((end.y - start.y) * scale, -12, 12) };
}

// DOM animation stays outside React's render loop. Every listener/frame is disposed.
export function startFloatingEmojis(layer, items, apiBase, gallery = false, count = 0) {
  const maximum = Number.isInteger(count) ? clamp(count, 0, 100) : 0;
  if (!items.length || maximum === 0) return () => {};
  const cleanup = new AbortController();
  const listener = { signal: cleanup.signal };
  const pointer = { x: -10000, y: -10000 };
  const sprites = [];
  let width = innerWidth, height = innerHeight, frame, last = 0, elapsed = 0;
  let fpsTime = 0, fpsFrames = 0, limit = maximum;
  const resize = () => { width = innerWidth; height = innerHeight; };
  window.addEventListener("resize", resize, listener);
  window.addEventListener("pointermove", event => {
    if (event.pointerType !== "touch") { pointer.x = event.clientX; pointer.y = event.clientY; }
  }, listener);
  document.addEventListener("pointerleave", () => { pointer.x = pointer.y = -10000; }, listener);
  function spawn() {
    const item = pick(items);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "floating-emoji";
    button.setAttribute("aria-label", `${item.name}: drag to throw${item.links.length ? ", click to open a link" : ""}`);
    const img = document.createElement("img");
    img.src = `${apiBase}${item.url}`; img.alt = ""; img.draggable = false;
    const bubble = document.createElement("span");
    bubble.className = "emoji-bubble"; bubble.hidden = true;
    button.append(img, bubble); layer.append(button);
    const sprite = { button, img, bubble, item, x: random(0, Math.max(0, width - 64)), y: random(0, Math.max(0, height - 64)),
      vx: random(1.2, 2.5) * (Math.random() < .5 ? -1 : 1), vy: random(1.2, 2.5) * (Math.random() < .5 ? -1 : 1),
      age: 0, life: random(10, 60), nextQuote: elapsed + random(5, 15), bubbleUntil: 0,
      held: false, points: [], distance: 0, scale: 1, rotation: 0, phase: random(0, 10), link: pick(item.links) };
    const say = (held) => {
      const quotes = held ? item.heldQuotes : gallery && item.fanartQuotes.length ? item.fanartQuotes : item.quotes;
      const text = pick(quotes.length ? quotes : held ? ["Hey!", "Where are we going?", "Ready for takeoff!"] : ["Hello!", "Seen the latest video?", "Thanks for stopping by!"]);
      bubble.innerHTML = markdownToHtml(text);
      bubble.hidden = false; sprite.bubbleUntil = elapsed + random(2, 4);
      sprite.nextQuote = elapsed + (held ? random(2, 4) : random(5, 15));
    };
    sprite.say = say;
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0 || sprite.held) return;
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      sprite.held = true; sprite.pointerId = event.pointerId; sprite.distance = 0;
      sprite.offsetX = event.clientX - sprite.x; sprite.offsetY = event.clientY - sprite.y;
      sprite.points = [{ x: event.clientX, y: event.clientY, time: performance.now() }];
      say(true);
    });
    button.addEventListener("pointermove", event => {
      if (!sprite.held || event.pointerId !== sprite.pointerId) return;
      const previous = sprite.points.at(-1);
      sprite.distance += Math.hypot(event.clientX - previous.x, event.clientY - previous.y);
      sprite.points.push({ x: event.clientX, y: event.clientY, time: performance.now() });
      sprite.points = sprite.points.slice(-20);
      sprite.x = clamp(event.clientX - sprite.offsetX, 0, Math.max(0, width - 64));
      sprite.y = clamp(event.clientY - sprite.offsetY, 0, Math.max(0, height - 64));
    });
    const release = (event, cancelled = false) => {
      if (!sprite.held || event.pointerId !== sprite.pointerId) return;
      sprite.held = false;
      sprite.points.push({ x: event.clientX, y: event.clientY, time: performance.now() });
      const velocity = throwVelocity(sprite.points);
      if (Math.hypot(velocity.x, velocity.y) > 0) { sprite.vx = velocity.x; sprite.vy = velocity.y; }
      bubble.hidden = true; sprite.nextQuote = elapsed + random(5, 15);
      if (!cancelled && sprite.distance < 5) {
        if (sprite.link) window.open(sprite.link, "_blank", "noopener,noreferrer");
      }
    };
    button.addEventListener("pointerup", event => release(event));
    button.addEventListener("pointercancel", event => release(event, true));
    button.addEventListener("lostpointercapture", event => release(event, true));
    button.addEventListener("click", event => { if (event.detail === 0) { say(false); if (sprite.link) window.open(sprite.link, "_blank", "noopener,noreferrer"); } });
    sprites.push(sprite);
  }
  function tick(now) {
    const seconds = Math.min((now - (last || now)) / 1000, .05); last = now;
    const dt = seconds * 60; elapsed += seconds;
    const blocked = Boolean(document.querySelector('dialog[open], .modal[aria-modal="true"]'));
    layer.hidden = blocked;
    if (!blocked) {
      fpsTime += seconds; fpsFrames++;
      if (fpsTime >= 3) { const fps = fpsFrames / fpsTime; if (fps < 30) limit = Math.max(Math.min(3, maximum), limit - 1); else if (fps > 45) limit = Math.min(maximum, limit + 1); fpsTime = 0; fpsFrames = 0; }
      while (sprites.length < limit) spawn();
      for (let index = sprites.length - 1; index >= 0; index--) {
        const s = sprites[index];
        const distance = Math.hypot(pointer.x - s.x - 32, pointer.y - s.y - 32);
        if (!s.held && (s.age < .6 || distance > 200 || s.age > s.life - 4)) s.age += seconds;
        if (!s.held && (s.age >= s.life || sprites.length > limit)) { s.button.remove(); sprites.splice(index, 1); continue; }
        if (!s.held) {
          const slowdown = clamp((distance - 30) / 170, 0, 1);
          s.x += s.vx * dt * slowdown; s.y += s.vy * dt * slowdown;
          const maxX = Math.max(0, width - 64), maxY = Math.max(0, height - 64);
          if (s.x <= 0 || s.x >= maxX) { s.vx *= -1; s.x = clamp(s.x, 0, maxX); }
          if (s.y <= 0 || s.y >= maxY) { s.vy *= -1; s.y = clamp(s.y, 0, maxY); }
          if (Math.hypot(s.vx, s.vy) > 3) { s.vx *= .985 ** dt; s.vy *= .985 ** dt; }
        }
        if (elapsed >= s.nextQuote) s.say(s.held);
        if (elapsed > s.bubbleUntil) s.bubble.hidden = true;
        const targetScale = s.held || distance < 80 ? 1.25 : 1;
        s.scale += (targetScale - s.scale) * Math.min(1, .12 * dt);
        s.rotation += ((s.held || distance < 60 ? Math.sin(elapsed * 12 + s.phase) * 12 : 0) - s.rotation) * Math.min(1, .12 * dt);
        const squish = s.held || distance < 60 ? .9 + Math.sin(elapsed * 10) * .04 : 1;
        s.button.style.transform = `translate3d(${s.x}px,${s.y}px,0)`;
        s.button.style.opacity = .85 * Math.min(1, s.age / .6, (s.life - s.age) / 4);
        s.img.style.transform = `translateY(${Math.sin(elapsed * 1.2 + s.phase) * 2}px) rotate(${s.rotation}deg) scale(${s.scale / squish},${s.scale * squish})`;
        s.button.classList.toggle("is-held", s.held);
        s.button.classList.toggle("is-near", distance < 80);
        s.bubble.style.bottom = s.y < 90 ? "auto" : "76px";
        s.bubble.style.top = s.y < 90 ? "76px" : "auto";
        s.bubble.style.left = `${clamp(s.x + 32 - 100, 8, Math.max(8, width - 208)) - s.x}px`;
      }
    }
    frame = requestAnimationFrame(tick);
  }
  const visibility = () => { cancelAnimationFrame(frame); last = 0; if (!document.hidden) frame = requestAnimationFrame(tick); };
  document.addEventListener("visibilitychange", visibility, listener);
  visibility();
  return () => { cleanup.abort(); cancelAnimationFrame(frame); layer.replaceChildren(); };
}
