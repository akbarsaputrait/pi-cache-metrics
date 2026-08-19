# Cache Metrics

Live prompt-cache visibility in the Pi footer. Tracks hit/miss rates, cache token usage, and estimated cost savings across the session.

**What is prompt caching?** Providers reuse your context prefix (system prompt + tools + conversation history) across requests. A **cache hit** (high hit-rate) means those tokens were served from cache instead of reprocessed — faster responses, lower cost. **Misses** write new tokens into the cache for future reuse.

## Install

Auto-discovered from `~/.pi/agent/extensions/` (hot-reload via `/reload`):

```bash
cp cache-metrics.ts ~/.pi/agent/extensions/
```

Or quick-test a single run:

```bash
pi -e ./cache-metrics.ts
```

Or via npm:

```bash
pi install npm:pi-cache-metrics
# run directly: pi -e npm:pi-cache-metrics
```

> Package name: `pi-cache-metrics`. (Originally `pi-cache-insight`, renamed because that name was taken on npm.)

## Commands

| Command | Description |
|---------|-------------|
| `/cache` | Show session summary (hit rate, tokens, savings, per-model breakdown, hit-rate trend chart) |
| `/cache-log` | Show recent requests (last 10 of 50 kept) |
| `/cache-settings` | Open interactive TUI settings (up/down to navigate, Enter to cycle, Esc to close) |

### `/cache` example output

```
Cache Metrics — session summary
provider/model: anthropic/claude-sonnet-4-5
requests: 52  hits: 37  misses: 0  no-cache: 15
hit rate: 100.0%
cache read tokens: 2626560
cache write tokens: 0
estimated savings: $0.024

Per-model:
  anthropic/claude-sonnet-4-5: 52 req, 100% hit, $0.024 saved

Settings:
  footer: on (compact)
  cost precision: 2
  hit-rate alert: 50%
  track models: all
  color theme: auto

hit-rate trend (oldest → newest):
▂▃▄▅▆▇█▇▆▅▄▃▂▁▁▂▃▄▅▆▇█▇▆
  ▁ low · █ high · . no cache-eligible requests
```

### `/cache` example output

```
Cache Metrics — session summary
provider/model: anthropic/claude-sonnet-4-5
requests: 52  hits: 37  misses: 0  no-cache: 15
hit rate: 100.0%
cache read tokens: 2626560
cache write tokens: 0
estimated savings: $0.024

Settings:
  footer: on (compact)
  cost precision: 2
  hit-rate alert: 50%
  track models: all
  color theme: auto
```

### `/cache-settings` (TUI)

The interactive settings panel includes a short on-screen explanation of caching, plus:

| Setting | Values |
|---------|--------|
| Show Footer | `on` / `off` |
| Footer Format | `compact` / `detailed` |
| Cost Precision (decimals) | `0`–`6` |
| Hit-Rate Alert Threshold (%) | `off` / `10`–`100` |
| Color Theme | `auto` / `mono` / `color` |

## Features

- **Provider-agnostic** — uses Pi's normalized `Usage` (`cacheRead`, `cacheWrite`, `cost.cacheRead`, `cost.cacheWrite`), not fragile response headers
- **Hit/miss classification** — `cacheRead > 0` = hit; `cacheWrite > 0 && cacheRead === 0` = miss (cache populated); both zero = no-cache
- **Live footer** — `💾 cache 67% (8H/4M) · cr12k/cw8.2k · -$0.0042`
- **Color-coded** — green ≥70%, yellow 40-69%, dim <40% (mono mode available)
- **Branch-safe persistence** — state stored as `appendEntry` custom entries, survives `/reload` and session forks
- **Hit-rate alerts** — optional notification when rate drops below threshold
- **Per-model breakdown** — `/cache` shows aggregates per model
- **ASCII trend chart** — `/cache` renders hit rate over time (blocks ▁→█, `.` = no cache-eligible requests)
- **Bounded log** — `/cache-log` keeps the last 50 requests in memory, shows the latest 10

## Data Source

Hooks `message_end` → `event.message.usage`. Pi normalizes per-provider cache tokens (Anthropic `cache_read_input_tokens`, OpenAI cache usage, etc.) into a single `Usage` object. This is more robust than parsing provider-specific headers, which the docs note are not uniformly exposed across providers/transports.

**Savings** are estimated by looking up the model's input rate from `ctx.model`, the model registry, or inferring from usage — whichever is available.

## Self-Test

```bash
CACHE_DEBUG_SELFTEST=1 pi -e ./cache-metrics.ts -p '1+1'
# [cache-metrics] selfTest: 9 assertions passed
```

Or standalone (no Pi, no keys):

```bash
bun run cache-metrics.test.ts
```

## License

MIT