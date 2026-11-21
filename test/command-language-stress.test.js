const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");

test("the public JSON arena runs from scratch with every fight-specific backend blocked", (t) => {
  const root = path.resolve(__dirname, ".."),
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "groby-language-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const script = `
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const load=Module._load;
Module._load=function(id,...rest){if(/command-(?:duels|legacy-duel-functions|arena-)/.test(id))throw Error('Fight backend is forbidden in this test');return load.call(this,id,...rest)};
const data=JSON.parse(fs.readFileSync(path.join(process.cwd(),'public/core/recipes/d20-arena.json'),'utf8'));
const source=data.stages.map(s=>s.source).join('\\n\\n');
const {render}=require('./src/domains/twitch/command-template');
const file=path.join(process.argv[1],'values.json'), owner=require('./src/domains/twitch/command-counters')(file);
(async()=>{
for(let roll=1;roll<=20;roll++){
const counter=owner('channel'+roll,false,true);
counter('player hero xp','set',100);counter('player rival xp','set',100);
const text=await render(source,{context:{sender:'hero',argv:['@rival']},counter,random:()=>(roll-.5)/20});
const win=roll>=16;
assert.match(text,new RegExp('NEED: 16\\\\+.*ROLLED: hero rolled '+roll+'/20'));
assert.equal(counter('player hero wins','get'),win?1:0);
assert.equal(counter('player hero losses','get'),win?0:1);
assert.ok(counter('player '+(win?'hero':'rival')+' xp','get')>100);
assert.ok(counter('player '+(win?'rival':'hero')+' xp','get')<100);
counter.commit();
}
const restarted=require('./src/domains/twitch/command-counters')(file);
assert.equal(restarted('channel20')('player hero wins','get'),1);
const snapshot=require('./test/support/counter-snapshot.cjs');const before=snapshot(file);
for(const name of ['hero','@HERO']){const counter=restarted('channel20',false,true);const text=await render(source,{context:{sender:'hero',argv:[name]},counter,random:()=>.99});assert.match(text,/No XP, wins, losses or rating changes/);counter.commit();}
assert.equal(snapshot(file),before);
const edited=source.replace('set difficulty 16','set difficulty 12').replace('set xpAward 10 + (100 - winnerChance) * 2 / 5 + margin','set xpAward 17');
const custom=restarted('custom',false,true);const text=await render(edited,{context:{sender:'hero',argv:['rival']},counter:custom,random:()=>.575});
assert.match(text,/NEED: 12\\+/);assert.equal(custom('player hero wins','get'),1);assert.equal(custom('player hero xp','get'),17);
assert.equal(await render('\${set person username 1}\${addstat person mana 7}\${stat person mana}',{context:{argv:['@NewPlayer']},counter:restarted('another',false,true)}),'7');
const cleanup=[];const f=require('./test/support/twitch-automation-fixture.cjs')({after:fn=>cleanup.push(fn)});
try{const preview=await f.automations.preview({template:source,arguments:'rival'});assert.match(preview.text,/NEED:.*ROLLED:.*RESULT:/);assert.equal(fs.existsSync(f.file.replace('.json','.duels.json')),false);}finally{for(const fn of cleanup.reverse())await fn();}
})().catch(e=>{console.error(e);process.exitCode=1});`;
  const result = spawnSync(process.execPath, ["-e", script, temp], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("the reference has one recommended form per operation and covers every arena building block", () => {
  const rows = require("../src/domains/twitch/command-variable-guide"),
    syntax = rows.map((r) => r.syntax);
  assert.equal(new Set(syntax).size, syntax.length);
  for (const alias of ["${target}", "${opponent}", "${target.game}", "${fight}"])
    assert.ok(!syntax.includes(alias));
  for (const name of ["set", "if", "stat"])
    assert.equal(syntax.filter((s) => s.startsWith("${" + name + " ")).length, 1);
  for (const name of [
    "username",
    "same",
    "set",
    "stat",
    "addstat",
    "setstat",
    "top",
    "if",
    "else",
    "end",
    "add",
    "subtract",
    "limit",
    "round",
    "math",
    "random.pick",
  ])
    assert.ok(
      syntax.some((s) => s.startsWith("${" + name + " ") || s === "${" + name + "}"),
      name + " must be discoverable",
    );
});

test("text values and choices preserve punctuation without evaluating viewer input", async () => {
  const { render } = require("../src/domains/twitch/command-template");
  const input = "${countinjected}|[a]{b}";
  let writes = 0;
  assert.equal(
    await render('${set message "A|B [box] {text}: ${args}"}${message}', {
      context: { argv: [input] },
      counter: () => {
        writes++;
        return 0;
      },
    }),
    "A|B [box] {text}: " + input,
  );
  assert.equal(writes, 0);
  assert.equal(
    await render('${random.pick "left | right" "other"}', { random: () => 0 }),
    "left | right",
  );
  assert.equal(await render("${if 1 == 1}Win | lose${else}No${end}"), "Win | lose");
  assert.equal(await render('${same "Red Dragon" "red dragon"}'), "1");
  assert.equal(await render('${same "red | blue" "RED | BLUE"}'), "1");
});
test("saved counter reads follow explicit writes while shorthand increments once per message", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "groby-counter-order-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const counter = require("../src/domains/twitch/command-counters")(path.join(dir, "counter.json"))(
    "owner",
    false,
    true,
  );
  const { render } = require("../src/domains/twitch/command-template");
  assert.equal(
    await render(
      "${setcount score 5}/${readcountscore}/${addcount score 2}/${readcountscore}/${addcount score 2}/${readcountscore}",
      { counter },
    ),
    "5/5/7/7/9/9",
  );
  assert.equal(
    await render("${countscore}/${countscore}/${readcountscore}", { counter }),
    "10/10/10",
  );
});
test("temporary values accept context functions and conditions accept live state or text comparisons", async () => {
  const { render } = require("../src/domains/twitch/command-template");
  const context = {
    sender: "viewer",
    user: "target",
    role: "moderator",
    channel: "channel",
    argv: ["first", "hello", "there"],
  };
  const lookup = async () => ({ game: "Music", live: true });
  assert.equal(await render("${set category game user}${category}", { context, lookup }), "Music");
  assert.equal(await render("${set phrase args 2}${phrase}", { context }), "hello there");
  assert.equal(await render("${if live}Online${else}Offline${end}", { context, lookup }), "Online");
  assert.equal(await render('${if same role "moderator"}Yes${else}No${end}', { context }), "Yes");
  assert.equal(await render("${if false}No${else}Yes${end}", { context }), "Yes");
});
