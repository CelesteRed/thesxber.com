import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";

const database = process.env.TEST_EMBED_DATABASE_URL || "";
if (database && new URL(database).pathname !== "/sxber_embed_test") throw new Error("Use a disposable sxber_embed_test database");
process.env.DATABASE_URL = database;
process.env.DATABASE_SSL = "false";
process.env.YOUTUBE_API_KEY = "test-key-never-sent";
process.env.YOUTUBE_CHANNEL_ID = "test-channel";
const db = await import("./db.js");
const { createYouTubeStore } = await import("./youtube-store.js");
const { createYouTubeService, YOUTUBE_HOUR_MS: HOUR } = await import("./youtube.js");
const { registerVideoRoutes } = await import("./video-routes.js");
const video = (id, title = "YouTube title") => ({ contentDetails: { videoId: id, videoPublishedAt: "2026-09-14T00:00:00Z" },
  snippet: { title, thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } }, status: { privacyStatus: "public" } });
const first = "abcdefghij1", second = "abcdefghij2";
const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });

async function fixture(t, useDb = false) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sxber-video-test-"));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  if (useDb) await db.query("TRUNCATE youtube_videos, youtube_cache_state");
  const filename = path.join(scratch, "youtube.json");
  const options = { filename, database: useDb };
  const store = createYouTubeStore(options);
  let clock = Date.parse("2026-09-14T00:00:00Z");
  let fail = false;
  let entries = [video(first), video(second)];
  let hold = null;
  let page = false;
  let failSecondPage = false;
  let failDetails = false;
  let count = "12345";
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    assert.equal(url.hostname, "www.googleapis.com");
    assert.notEqual(url.pathname, "/youtube/v3/search");
    if (hold) await hold;
    if (fail) return response({ error: { errors: [{ reason: "rateLimitExceeded" }], message: "private provider detail" } },429);
    if (url.pathname.endsWith("/channels")) return response({ items: [{ contentDetails: { relatedPlaylists: { uploads: "uploads-playlist" } } }] });
    if (url.pathname.endsWith("/videos")) {
      if (failDetails) return response({},503);
      const ids = url.searchParams.get("id").split(",");
      assert.ok(ids.length <= 50, "Statistics are batched within the API limit");
      assert.match(url.searchParams.get("part"), /statistics/);
      return response({ items: ids.map(id => ({ id, status: { privacyStatus: "public" }, statistics: { viewCount: count }, contentDetails: { duration: "PT12M48S" }, snippet: { description: "A real provider description." } })) });
    }
    assert.equal(url.searchParams.get("playlistId"),"uploads-playlist");
    if (failSecondPage && url.searchParams.has("pageToken")) return response({},503);
    if (page && !url.searchParams.has("pageToken")) return response({ items: entries.slice(0,1), nextPageToken: "page2" });
    return response({ items: page ? entries.slice(1) : entries });
  };
  let detectedFormat = "video";
  const serviceOptions = { key:"test-key-never-sent", channelId:"channel", now:() => clock, fetcher, intervalMs:60000, detectFormat: async () => detectedFormat };
  const service = createYouTubeService({ ...serviceOptions, store });
  return { service, store, calls, advance: ms => clock += ms, failing: value => fail = value, entries: value => entries = value,
    hold: value => hold = value, paginate: () => page = true, failSecondPage: () => failSecondPage = true,
    failDetails: value => failDetails = value, viewCount: value => count = value,
    detectedFormat: value => detectedFormat = value,
    restart: () => createYouTubeService({ ...serviceOptions, store: createYouTubeStore(options) }) };
}

async function persistenceAndCooldown(t, useDb = false) {
  const f = await fixture(t,useDb);
  f.paginate();
  await f.service.sync();
  assert.equal(f.calls.length,5,"One channel lookup, two uploads pages, and two statistics batches");
  assert.equal((await f.service.adminFeed()).items.length,2);
  await Promise.all(Array.from({length:10}, () => f.service.publicFeed()));
  await f.service.sync();
  assert.equal(f.calls.length,5,"Reads and early automatic checks never spend quota");
  await f.service.update(first,{hidden:true,hoverText:"<b>Custom hover</b>",format:"short"});
  const publicFeed = await f.service.publicFeed();
  assert.equal(publicFeed.items.length,1);
  assert.equal(publicFeed.items[0].id,second);
  assert.equal(Object.hasOwn(publicFeed.items[0],"hidden"),false);
  assert.equal(Object.hasOwn(publicFeed,"sync"),false);
  // A manual request is available independently of the automatic schedule.
  await f.service.sync({manual:true});
  const manualCalls = f.calls.length;
  assert.equal(manualCalls,9,"Uploads playlist lookup is reused");
  const restarted = f.restart();
  await assert.rejects(restarted.sync({manual:true}), error => error.status===429 && Boolean(error.nextSyncAt));
  assert.equal(f.calls.length,manualCalls,"Restart cannot reset the manual cooldown");
  assert.equal((await restarted.adminFeed()).items.find(item=>item.id===first).hoverText,"<b>Custom hover</b>");
  f.advance(HOUR-1);
  await restarted.sync();
  await assert.rejects(restarted.sync({manual:true}),{status:429});
  assert.equal(f.calls.length,manualCalls);
  f.advance(1);
  f.entries([video(first,"New YouTube title"),video(second)]);
  await restarted.sync({manual:true});
  const edited=(await restarted.adminFeed()).items.find(item=>item.id===first);
  assert.equal(edited.title,"New YouTube title");
  assert.equal(edited.hidden,true);
  assert.equal(edited.hoverText,"<b>Custom hover</b>");
  assert.equal(edited.format,"short","Format survives sync and restart in both storage modes");
  assert.equal(edited.viewCount,"12345");
  assert.equal(edited.duration,"PT12M48S");
  assert.equal(edited.description,"A real provider description.");
  await restarted.update(first,{hidden:false,hoverText:""});
  assert.equal((await restarted.publicFeed()).items.length,2);
  assert.equal((await restarted.publicFeed()).items.find(item=>item.id===first).hoverText,"");
}

test("uploads pagination, hourly scheduling, persistent metadata and cooldown", t=>persistenceAndCooldown(t));
test("automatic format detection corrects defaults while preserving explicit overrides", async t => {
  const f = await fixture(t);
  await f.service.sync();
  f.detectedFormat("short");
  f.advance(HOUR);
  await f.service.sync();
  assert.ok((await f.restart().publicFeed()).items.every(item => item.format === "short"));
  assert.match((await f.service.publicFeed()).items[0].videoUrl, /\/shorts\//);
  await f.service.update(first,{format:"video"});
  f.advance(HOUR);
  await f.service.sync();
  assert.equal((await f.restart().adminFeed()).items.find(item => item.id === first).format,"video");
  await f.service.update(first,{format:"auto"});
  const reset=(await f.service.adminFeed()).items.find(item => item.id === first);
  assert.equal(reset.format,"short");
  assert.equal(reset.formatOverride,false);
  f.detectedFormat(null);
  f.advance(HOUR); await f.service.sync();
  assert.ok((await f.service.publicFeed()).items.every(item => item.format === "short"),"Temporary detection failures retain last known format");
});

test("Shorts routing detection is cached and never mistakes consent or errors for Videos", async () => {
  const { createFormatDetector, identifyVideoFormats } = await import("./youtube-format.js");
  let calls=0;
  const detect=createFormatDetector({fetcher:async url => {
    calls++;
    const id=url.split('/').at(-1);
    if(id===first) return new Response('x'.repeat(300000)+`<link rel="canonical" href="https://www.youtube.com/shorts/${id}"></head>`);
    if(id===second) return new Response(null,{status:303,headers:{location:`https://www.youtube.com/watch?v=${id}`}});
    return new Response(null,{status:302,headers:{location:'https://consent.youtube.com/'}});
  }});
  assert.deepEqual(await Promise.all([detect(first),detect(first)]),['short','short']);
  assert.equal(calls,1);
  assert.equal(await detect(second),'video');
  assert.equal(await detect('abcdefghij3'),null);
  assert.equal(await detect('../bad'),null);
  const result=await identifyVideoFormats([{id:first},{id:second},{id:'abcdefghij3'}],detect);
  assert.deepEqual(result.map(item=>item.format),['short','video','unknown']);
  assert.equal(calls,3);
});
test("failed first classification stays unknown instead of populating Videos", async t => {
  const f=await fixture(t);
  f.detectedFormat(null);
  await f.service.sync();
  assert.ok((await f.service.publicFeed()).items.every(item => item.format === "unknown"));
});

test("legacy live preview enriches missing formats once without changing explicit labels", async t => {
  const { liveYouTubePreview } = await import('./youtube-preview.js');
  let fetches=0, detections=0;
  const plugin=liveYouTubePreview('https://example.com',{
    fetcher:async (_url, options) => {
      fetches++;
      assert.equal(options.headers,undefined,"No browser cookies or authorization are forwarded");
      return response({items:[{id:first},{id:second,format:'video'}]});
    },
    identify:async items => {detections++;assert.deepEqual(items.map(i=>i.id),[first]);return items.map(i=>({...i,format:'short'}));},
    enrichCounts:async items => items.map(item => ({...item,viewCount:'12345'}))
  });
  const app=express();plugin.configureServer({middlewares:app});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url=`http://127.0.0.1:${server.address().port}/api/youtube`;
  const feeds=await Promise.all(Array.from({length:4},async()=> (await fetch(url)).json()));
  assert.deepEqual(feeds[0].items.map(i=>i.format),['short','video']);
  assert.ok(feeds[0].items.every(item => item.viewCount === '12345'));
  assert.equal(fetches,1);assert.equal(detections,1);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
});
test('preview counts use the matching player only and preserve API statistics', async () => {
  const { publicViewCount, enrichPreviewCounts } = await import('./youtube-preview-counts.js');
  const html = `var ytInitialPlayerResponse = ${JSON.stringify({videoDetails:{videoId:first,title:'quoted " and } text',viewCount:'987654321012345678'}})};`;
  assert.equal(publicViewCount(html,first),'987654321012345678');
  assert.equal(publicViewCount(html,second),null);
  assert.equal(publicViewCount('<html>Consent required</html>',first),null);
  assert.equal(publicViewCount(html.slice(0,-10),first),null);
  let calls=0;
  const items=await enrichPreviewCounts([{id:first},{id:second,viewCount:'0'}],{fetcher:async()=>{calls++;return new Response(html);}});
  assert.deepEqual(items.map(item=>item.viewCount),['987654321012345678','0']);
  assert.equal(calls,1);
  const failed=await enrichPreviewCounts([{id:first}],{fetcher:async()=>{throw new Error('Unavailable');}});
  assert.equal(failed[0].viewCount,undefined);
});
test("concurrent syncs and edits cannot bypass claims or erase metadata",async t=>{
  const f=await fixture(t);
  await f.service.sync();
  let release;
  f.hold(new Promise(resolve=>release=resolve));
  const pending=f.service.sync({manual:true});
  while (!(await f.service.adminFeed()).sync.inProgress) await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.service.sync({manual:true}),{status:409});
  await f.service.sync();
  await f.service.update(first,{hidden:true,hoverText:"Edited during sync",format:"short"});
  release();
  await pending;
  assert.equal(f.calls.length,5);
  const item=(await f.service.adminFeed()).items.find(item=>item.id===first);
  assert.equal(item.hidden,true);
  assert.equal(item.hoverText,"Edited during sync");
  assert.equal(item.format,"short");
});
test("failed and partial syncs keep cache and consume the manual cooldown",async t=>{
  const f=await fixture(t);
  await f.service.sync();
  const before=await f.service.publicFeed();
  f.advance(1000); f.failing(true);
  await assert.rejects(f.service.sync({manual:true}),{status:502});
  assert.deepEqual(await f.service.publicFeed(),before);
  assert.match((await f.service.adminFeed()).error,/quota exceeded/);
  await assert.rejects(f.restart().sync({manual:true}),{status:429});
  const count=f.calls.length;
  f.advance(HOUR-1); await f.service.sync();
  assert.equal(f.calls.length,count);
  f.advance(1); f.failing(false); await f.service.sync();
  assert.equal((await f.service.adminFeed()).error,null);
  const restored = await f.service.publicFeed();
  f.paginate(); f.failSecondPage(); f.entries([video(first,"Partial replacement"),video(second)]);
  await assert.rejects(f.service.sync({manual:true}),{status:502});
  assert.deepEqual(await f.service.publicFeed(),restored,"A failed later page cannot publish a partial feed");
  await assert.rejects(f.service.sync({manual:true}),{status:429});
});
test("unavailable uploads leave the feed and recover their moderation when restored",async t=>{
  const f=await fixture(t);
  await f.service.sync();
  await f.service.update(first,{hidden:true,hoverText:"Keep this override",format:"short"});
  f.entries([video(second),{...video(first),status:{privacyStatus:"private"}}]);
  f.advance(HOUR); await f.service.sync();
  assert.equal((await f.service.adminFeed()).items.length,1);
  f.entries([video(first),video(second)]);
  f.advance(HOUR); await f.service.sync();
  assert.equal((await f.service.adminFeed()).items.find(item=>item.id===first).hoverText,"Keep this override");
  assert.equal((await f.service.adminFeed()).items.find(item=>item.id===first).format,"short");
  assert.equal((await f.service.publicFeed()).items.length,1);
  for(const input of [{hidden:"false"},{hoverText:"x".repeat(121)},{title:"No"},{format:"shorts"},{format:null},{format:true},{},null]) await assert.rejects(f.service.update(first,input),{status:400});
  await assert.rejects(f.service.update("missing0000",{hidden:true}),{status:404});
});
test("each shelf gets its own latest 20 visible uploads, including older long videos", async t => {
  const f = await fixture(t);
  f.entries(Array.from({ length: 48 }, (_, index) => ({
    ...video(`clip${String(index).padStart(7,"0")}`),
    contentDetails: { videoId: `clip${String(index).padStart(7,"0")}`, videoPublishedAt: new Date(Date.UTC(2026,8,16) - index * 60000).toISOString() }
  })));
  await f.service.sync();
  const all = (await f.service.adminFeed()).items;
  assert.ok(all.every(item => item.format === "video"), "Uncategorized uploads default to Videos");
  for (const item of all.slice(0,24)) await f.service.update(item.id, { format: "short" });
  await f.service.update(all[0].id, { hidden: true });
  await f.service.update(all[24].id, { hidden: true });
  const { items } = await f.restart().publicFeed();
  const shorts = items.filter(item => item.format === "short");
  const videos = items.filter(item => item.format === "video");
  assert.equal(shorts.length,20);
  assert.equal(videos.length,20);
  assert.equal(shorts[0].id,all[1].id);
  assert.equal(videos[0].id,all[25].id);
  assert.equal(new Set(items.map(item => item.id)).size,40);
  assert.ok(items.every(item => !Object.hasOwn(item,"hidden") && !Object.hasOwn(item,"inFeed")));
  await f.service.update(shorts[0].id, { format: "video" });
  assert.equal((await f.service.publicFeed()).items.filter(item => item.id === shorts[0].id).length,1);
});

test("statistics refresh safely, distinguish missing counts from zero, and preserve the cache on failure", async t => {
  const f = await fixture(t);
  f.viewCount("0");
  await f.service.sync();
  assert.equal((await f.restart().publicFeed()).items[0].viewCount,"0");
  const before = await f.service.publicFeed();
  f.failDetails(true);
  await assert.rejects(f.service.sync({manual:true}), {status:502});
  assert.deepEqual(await f.service.publicFeed(),before);
  f.failDetails(false);
  f.advance(HOUR);
  f.viewCount(undefined);
  await f.service.sync();
  assert.equal((await f.service.publicFeed()).items[0].viewCount,null);
  f.advance(HOUR);
  f.viewCount("9007199254740993");
  await f.service.sync();
  assert.equal((await f.restart().publicFeed()).items[0].viewCount,"9007199254740993");
});

test("view counts, upload dates and duration labels handle missing and large values", async () => {
  const { viewLabel, durationLabel, publishedLabel } = await import("../src/video-display.js");
  assert.equal(viewLabel(null),null);
  assert.equal(viewLabel(undefined),null);
  assert.equal(viewLabel(-1),null);
  assert.equal(viewLabel("0"),"0");
  assert.equal(viewLabel("12345"),"12.3K");
  assert.equal(viewLabel("9007199254740993",false),"9,007,199,254,740,993");
  assert.equal(durationLabel("PT1H2M3S"),"1:02:03");
  assert.equal(durationLabel("PT38S"),"0:38");
  assert.equal(durationLabel(null),null);
  assert.equal(durationLabel("PT0S"),null);
  assert.equal(publishedLabel("not-a-date"),null);
});

test("admin routes authenticate, reject simple cross-site posts, report cooldown and audit",async t=>{
  const f=await fixture(t);
  const app=express(); app.use(express.json());
  const requireAdmin=(req,res,next)=>{if(req.get("x-test-admin")!=="yes") return res.status(401).json({error:"Login required"}); req.adminUser={id:"test",username:"test-admin"};next();};
  registerVideoRoutes(app,requireAdmin,{read:()=>f.service.adminFeed(),sync:()=>f.service.sync({manual:true}),update:(id,input)=>f.service.update(id,input)});
  const server=app.listen(0,"127.0.0.1"); await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base=`http://127.0.0.1:${server.address().port}/api/admin/videos`;
  for(const [suffix,method] of [["","GET"],["/sync","POST"],[`/${first}`,"PATCH"]]) assert.equal((await fetch(base+suffix,{method})).status,401);
  assert.equal(f.calls.length,0);
  const headers={"x-test-admin":"yes","content-type":"application/json"};
  assert.equal((await fetch(base+"/sync",{method:"POST",headers:{"x-test-admin":"yes","content-type":"application/x-www-form-urlencoded"},body:""})).status,415);
  assert.equal((await fetch(base+"/sync",{method:"POST",headers,body:"{}"})).status,200);
  const denied=await fetch(base+"/sync",{method:"POST",headers,body:"{}"});
  assert.equal(denied.status,429); assert.ok(denied.headers.get("retry-after"));
  const edited=await fetch(base+`/${first}`,{method:"PATCH",headers,body:JSON.stringify({hidden:true,hoverText:"Custom",format:"short"})});
  assert.equal(edited.status,200); assert.equal(edited.headers.get("cache-control"),"no-store");
  assert.equal((await edited.json()).item.format,"short");
  const {listAdminActivity}=await import("./auth.js");
  const actions=(await listAdminActivity()).map(row=>row.action);
  assert.ok(actions.includes("video.sync")); assert.ok(actions.includes("video.update"));
});
test("actual app video routes require the existing admin authentication",async t=>{
  const {app}=await import("./index.js");
  const server=app.listen(0,"127.0.0.1"); await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  for(const [suffix,method] of [["","GET"],["/sync","POST"],[`/${first}`,"PATCH"]]) {
    const res=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/videos${suffix}`,{method}); assert.equal(res.status,401);
  }
});
test("PostgreSQL persists edits and serializes independent server cooldowns",{skip:!database},async t=>{
  await db.initializeDatabase();
  try {
    await persistenceAndCooldown(t,true);
    const f=await fixture(t,true);
    const other=f.restart();
    const results=await Promise.allSettled([f.service.sync({manual:true}),other.sync({manual:true})]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(results.filter(r=>r.status==="rejected").length,1);
    assert.equal(f.calls.length,3);
  } finally { await db.query("TRUNCATE youtube_videos, youtube_cache_state"); await db.closeDatabase(); }
});
