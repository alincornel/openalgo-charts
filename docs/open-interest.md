# Open interest data

Open interest is an optional `oi` value on the same `Bar` as OHLC and volume.
It describes a position level at that timestamp. Missing data is omitted;
zero means the feed actually reported zero.

```ts
series.setData([
  { time: 1700000040, open: 100, high: 103, low: 99, close: 102, volume: 20, oi: 140 },
  { time: 1700000100, open: 102, high: 104, low: 101, close: 103, volume: 10 },
]);
```

Historical aggregation adds volume because it counts activity during a period.
Open interest takes the latest defined reading within that bucket. Five readings
100, 110, 120, 130 and 140 therefore fold to 140. A bucket with no readings stays
absent; a previous bucket's level never fills it.

`securitySeries` exposes a parallel nullable `oi` column. Its default developing
reading can use only source bars already reached. `offset: 1` reads the previous
completed bucket; `lookahead: true` reads the completed bucket early and carries
the same future-data implications as the other columns.

Heikin Ashi preserves the column because each result maps to one source bar.
Renko, range, line break, point and figure and Kagi do not attach open interest
to price-generated bars. Expression results omit it even if combined leg volume
is requested: an expression is not one contract position.

`CandleBuilder` and `TickBarAggregator` replace open interest when a finite
`Tick.oi` or `AggTick.oi` arrives. A tick without it clears a previous value from
the forming bar. This is deliberate: a retained historical value would look like
a current observation without a staleness indication. OpenAlgo's current quote
feed supplies no open interest. Completed history can therefore show a reading
while the tick-driven forming bar has none.

REST mapping omits nonfinite optional readings. Durable caches reject malformed
levels. A history response arriving after a live update retains the live
observation, including its absence or zero. During partial replay, only revealed
sub-bars contribute a level; the completed bar's value appears when it closes.
