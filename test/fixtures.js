// Builds synthetic GTFS-realtime feeds with protobufjs (the reference encoder),
// so the hand-written decoder is checked against real protobuf bytes.
// Stops and lines here are made up for tests and are not anyone's commute.
import protobuf from 'protobufjs';

const root = protobuf.Root.fromJSON({
  nested: {
    transit_realtime: {
      nested: {
        FeedMessage: { fields: { header: { type: 'FeedHeader', id: 1 }, entity: { rule: 'repeated', type: 'FeedEntity', id: 2 } } },
        FeedHeader: { fields: { gtfs_realtime_version: { type: 'string', id: 1 }, timestamp: { type: 'uint64', id: 3 } } },
        FeedEntity: {
          fields: {
            id: { type: 'string', id: 1 },
            trip_update: { type: 'TripUpdate', id: 3 },
            vehicle: { type: 'VehiclePosition', id: 4 },
          },
        },
        VehiclePosition: { fields: { trip: { type: 'TripDescriptor', id: 1 }, current_stop_sequence: { type: 'uint32', id: 3 }, stop_id: { type: 'string', id: 7 } } },
        TripUpdate: {
          fields: {
            trip: { type: 'TripDescriptor', id: 1 },
            stop_time_update: { rule: 'repeated', type: 'StopTimeUpdate', id: 2 },
            timestamp: { type: 'uint64', id: 4 },
          },
        },
        TripDescriptor: {
          fields: {
            trip_id: { type: 'string', id: 1 },
            start_time: { type: 'string', id: 2 },
            start_date: { type: 'string', id: 3 },
            route_id: { type: 'string', id: 5 },
          },
        },
        StopTimeUpdate: {
          fields: {
            stop_sequence: { type: 'uint32', id: 1 },
            arrival: { type: 'StopTimeEvent', id: 2 },
            departure: { type: 'StopTimeEvent', id: 3 },
            stop_id: { type: 'string', id: 4 },
          },
        },
        StopTimeEvent: { fields: { delay: { type: 'int32', id: 1 }, time: { type: 'int64', id: 2 } } },
      },
    },
  },
});

const FeedMessage = root.lookupType('transit_realtime.FeedMessage');

/** trips: [{id, route, stops: [[stopId, time, {noArrival?, noDeparture?}]]}] */
export function encodeFeed(timestamp, trips) {
  const entity = [];
  trips.forEach((t, i) => {
    entity.push({
      id: 'e' + i,
      trip_update: {
        trip: { trip_id: t.id, start_date: '20260101', route_id: t.route },
        stop_time_update: t.stops.map(([stop, time, opts = {}]) => ({
          stop_id: stop,
          ...(opts.noArrival ? {} : { arrival: { time } }),
          ...(opts.noDeparture ? {} : { departure: { time } }),
        })),
      },
    });
    // NYCT feeds also carry vehicle entities; the decoder must skip them.
    entity.push({ id: 'v' + i, vehicle: { trip: { trip_id: t.id, route_id: t.route }, stop_id: t.stops[0][0] } });
  });
  const msg = FeedMessage.fromObject({ header: { gtfs_realtime_version: '1.0', timestamp }, entity });
  return FeedMessage.encode(msg).finish();
}

export const NOW = 1_800_000_000;

/**
 * Scenario, stops H01 (home), T01/T02 (transfers), W01 (work).
 * Routes "R>T01>7" and "N>T02>7". The 7 runs T02 -> T01 -> W01 northbound.
 */
export function scenario() {
  const n = NOW;
  return [
    // Northbound first legs
    { id: 'n1', route: 'N', stops: [['H01N', n + 60], ['T02N', n + 300]] },
    { id: 'n1b', route: 'N', stops: [['H01N', n + 120], ['T02N', n + 360]] },
    { id: 'n2', route: 'N', stops: [['H01N', n + 600], ['T02N', n + 840]] },
    { id: 'r1', route: 'R', stops: [['H01N', n + 360], ['T01N', n + 660]] },
    // Already left
    { id: 'r0', route: 'R', stops: [['H01N', n - 120], ['T01N', n + 180]] },
    // Connecting line northbound
    { id: 's1', route: '7', stops: [['T02N', n + 200], ['T01N', n + 320], ['W01N', n + 1000]] },
    { id: 's2', route: '7', stops: [['T02N', n + 500], ['T01N', n + 620], ['W01N', n + 1300]] },
    { id: 's3', route: '7', stops: [['T02N', n + 800], ['T01N', n + 920], ['W01N', n + 1600]] },
    // Southbound (for the home direction); R southbound must not appear going to work
    { id: 'rs', route: 'R', stops: [['T01S', n + 30], ['H01S', n + 330]] },
    { id: 'ss1', route: '7', stops: [['W01S', n + 100], ['T01S', n + 700], ['T02S', n + 820]] },
    { id: 'ns1', route: 'N', stops: [['T02S', n + 1000], ['H01S', n + 1300]] },
    { id: 'rs2', route: 'R', stops: [['T01S', n + 900], ['H01S', n + 1150]] },
    // Express variant id and an unrelated line
    { id: 'fx', route: 'FX', stops: [['H01N', n + 50], ['T01N', n + 100]] },
    { id: 'q', route: 'Q', stops: [['H01N', n + 10], ['W01N', n + 20]] },
  ];
}
