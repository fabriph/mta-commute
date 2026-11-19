import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFeed } from '../src/gtfsrt.js';
import {
  ConfigError, directionLegs, feedsFor, indexTrips, linesFor, parseConfig, planDirection,
} from '../src/planner.js';
import { NOW, encodeFeed, scenario } from './fixtures.js';
import { buildPlan } from '../src/plan.js';

const params = (s) => new URLSearchParams(s);

function plan(query, dir, now = NOW) {
  const config = parseConfig(params(query));
  const buf = encodeFeed(NOW - 20, scenario());
  const wanted = linesFor(config);
  const { trips } = decodeFeed(buf, (r) => wanted.has(r));
  return planDirection(indexTrips(trips), directionLegs(config, dir), now);
}

test('decoder reads header, trips, routes and stop times', () => {
  const feed = decodeFeed(encodeFeed(NOW, scenario()));
  assert.equal(feed.timestamp, NOW);
  assert.equal(feed.trips.length, scenario().length);
  const s2 = feed.trips.find((t) => t.id === 's2');
  assert.equal(s2.route, '7');
  assert.deepEqual(s2.stops.map((s) => s.stop), ['T02N', 'T01N', 'W01N']);
  assert.equal(s2.stops[2].arr, NOW + 1300);
  assert.equal(feed.trips.find((t) => t.id === 'fx').route, 'F', 'FX normalized to F');
});

test('decoder skips unwanted routes and fills missing arrival/departure', () => {
  const buf = encodeFeed(NOW, [
    { id: 'a', route: 'A', stops: [['X01N', NOW + 10, { noArrival: true }], ['X02N', NOW + 70, { noDeparture: true }]] },
    { id: 'b', route: 'B', stops: [['X01N', NOW]] },
  ]);
  const { trips } = decodeFeed(buf, (r) => r === 'A');
  assert.equal(trips.length, 1);
  assert.equal(trips[0].stops[0].arr, NOW + 10);
  assert.equal(trips[0].stops[1].dep, NOW + 70);
});

test('to work: picks the option that arrives first, not the one that leaves first', () => {
  const res = plan('h=H01&w=W01&r=R>T01>7,N>T02>7', 'work');
  const [best, second, third] = res.journeys;
  assert.ok(best.best);
  assert.deepEqual(best.legs.map((l) => l.trip), ['n1b', 's2']);
  assert.equal(best.arr, NOW + 1300);
  assert.deepEqual(second.legs.map((l) => l.trip), ['r1', 's3']);
  assert.equal(second.arr, NOW + 1600);
  assert.equal(third.legs[0].trip, 'n2');
  assert.equal(third.arr, null, 'no connection in feed yet');
});

test('earlier train making the same connection is dropped in favor of the later one', () => {
  const res = plan('h=H01&w=W01&r=R>T01>7,N>T02>7', 'work');
  assert.ok(!res.journeys.some((j) => j.legs[0].trip === 'n1'));
});

test('departed trains and wrong-direction trips are excluded', () => {
  const res = plan('h=H01&w=W01&r=R>T01>7,N>T02>7', 'work');
  const firsts = res.journeys.map((j) => j.legs[0].trip);
  assert.ok(!firsts.includes('r0'));
  assert.ok(!firsts.includes('rs'));
  const r = res.stations[0].boards.find((b) => b.line === 'R');
  assert.deepEqual(r.deps, [NOW + 360]);
});

test('transfer time changes which connection is possible', () => {
  // With 5 min to transfer, n1b (arrives T02 at +360) misses s2 (+500) and gets s3.
  const res = plan('h=H01&w=W01&r=N>T02>7:5', 'work');
  const j = res.journeys.find((x) => x.legs[0].trip === 'n1b');
  assert.equal(j.legs[1].trip, 's3');
});

test('to home: routes are reversed', () => {
  const res = plan('h=H01&w=W01&r=R>T01>7,N>T02>7', 'home');
  const best = res.journeys[0];
  assert.ok(best.best);
  assert.deepEqual(best.legs.map((l) => [l.line, l.from, l.to, l.trip]), [
    ['7', 'W01', 'T01', 'ss1'],
    ['R', 'T01', 'H01', 'rs2'],
  ]);
  assert.equal(best.arr, NOW + 1150);
  assert.equal(res.journeys[1].arr, NOW + 1300);
});

test('every catchable train is shown, even with an old walk-time param', () => {
  const res = plan('h=H01&w=W01&r=N>T02>7&k=5', 'work');
  const n1b = res.journeys.find((j) => j.legs[0].trip === 'n1b');
  assert.ok(n1b && n1b.best, 'a train leaving in 2 min is still recommended');
  assert.ok(!('missed' in n1b));
});

test('direct route and multi-line legs', () => {
  const res = plan('h=H01&w=T01&r=R|F', 'work');
  const trips = res.journeys.map((j) => j.legs[0].trip);
  assert.deepEqual(trips, ['fx', 'r1']);
});

test('config validation and feed selection', () => {
  assert.throws(() => parseConfig(params('w=W01&r=A')), ConfigError);
  assert.throws(() => parseConfig(params('h=H01&w=W01&r=XYZ')), ConfigError);
  assert.throws(() => parseConfig(params('h=H01&w=W01&r=A>T01')), ConfigError);
  assert.throws(() => parseConfig(params('h=H01&w=W01&r=A&x=99')), ConfigError);
  const c = parseConfig(params('h=h01&w=W01&r=f>t01/t09>a|c,g>T02>A'));
  assert.equal(c.home, 'H01');
  assert.deepEqual(c.routes[0].transfers, [{ alight: 'T01', board: 'T09' }]);
  assert.deepEqual(feedsFor(c).sort(), ['ace', 'bdfm', 'g']);
  const home = directionLegs(c, 'home')[0].legs;
  assert.deepEqual(home.map((l) => [l.from, l.to]), [['W01', 'T09'], ['T01', 'H01']]);
});

test('buildPlan uses the station names it is given, else stop ids', async () => {
  const load = async (_k, wanted) => decodeFeed(encodeFeed(NOW, scenario()), (r) => wanted.has(r));
  const q = params('h=H01&w=W01&r=N>T02>7&n=H01~Home Sq|T02~Swap St');
  const res = await buildPlan(q, load, { names: { H01: 'Home Sq', T02: 'Swap St' }, now: NOW });
  assert.deepEqual(res.names, { H01: 'Home Sq', W01: 'W01', T02: 'Swap St' });
  assert.ok(res.dirs.work.journeys.length);
});

test('departure boards cover the origin and every transfer station, in direction of travel', () => {
  const work = plan('h=H01&w=W01&r=R>T01>7,N>T02>7', 'work');
  assert.deepEqual(work.stations.map((s) => s.stop), ['H01', 'T01', 'T02']);
  const t01 = work.stations[1].boards;
  assert.deepEqual(t01.map((b) => b.line), ['7']);
  assert.deepEqual(t01[0].deps, [NOW + 320, NOW + 620, NOW + 920], 'northbound 7s at T01');
  const home = plan('h=H01&w=W01&r=R>T01>7,N>T02>7', 'home');
  assert.deepEqual(home.stations.map((s) => s.stop), ['W01', 'T01', 'T02']);
  assert.deepEqual(home.stations[1].boards, [{ line: 'R', deps: [NOW + 30, NOW + 900] }], 'southbound Rs at T01');
  assert.deepEqual(home.stations[2].boards, [{ line: 'N', deps: [NOW + 1000] }]);
});
