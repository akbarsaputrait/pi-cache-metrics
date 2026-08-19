# Cache Insight

Live prompt-cache visibility in the Pi footer. Tracks hit/miss rates, cache token usage, and estimated cost savings across the session.

## Install

Auto-discovered from `~/.pi/agent/extensions/` (hot-reload via `/reload`):

```bash
cp cache-insight.ts ~/.pi/agent/extensions/
```

Or quick-test a single run:

```bash
pi -e ./cache-insight.ts
```

## Commands

| Command | Description |
|---------|-------------|
| `/cache` | Show session summary (hit rate, tokens, savings, settings) |
| `/cache-settings` | Configure display and alerts |

### `/cache-settings` options

```
footer [on|off|compact|detailed|toggle]   # Show/hide footer, change format
precision <0-6>                           # Decimal places for savings
alert <0-100|off>                         # Warn when hit-rate drops below threshold
models <all|csv>                          # Track specific models (e.g. claude,gpt)
color <auto|mono|color>                   # Footer coloring
reset                                      # Reset stats & settings to defaults
show                                       # Print current report + settings
```

Examples:
```
/cache-settings footer detailed
/cache-settings precision 2
/cache-settings alert 60
/cache-settings models claude,gpt
/cache-settings color mono
/cache-settings reset
```

## Features

- **Provider-agnostic** — uses Pi's normalized `Usage` (`cacheRead`, `cacheWrite`, `cost.cacheRead`, `cost.cacheWrite`), not fragile response headers
- **Hit/miss classification** — `cacheRead > 0` = hit; `cacheWrite > 0 && cacheRead === 0` = miss (cache populated); both zero = no-cache
- **Live footer** — `💾 cache 67% (8H/4M) · cr12k/cw8.2k · -$0.0042`
- **Color-coded** — green ≥70%, yellow 40-69%, dim <40% (mono mode available)
- **Branch-safe persistence** — state stored as `appendEntry` custom entries, survives `/reload` and session forks
- **Hit-rate alerts** — optional notification when rate drops below threshold
- **Model filtering** — track all models or specific ones

## Data Source

Hooks `message_end` → `event.message.usage`. Pi normalizes per-provider cache tokens (Anthropic `cache_read_input_tokens`, OpenAI cache usage, etc.) into a single `Usage` object. This is more robust than parsing provider-specific headers, which the docs note are not uniformly exposed across providers/transports.

## Self-Test

```bash
CACHE_DEBUG_SELFTEST=1 pi -e ~/.pi/agent/extensions/cache-insight.ts -p '1+1'
# [cache-insight] selfTest: 9 assertions passed
```

Or standalone (no Pi, no keys):

```bash
bun run ~/.pi/agent/cache-insight.test.ts
```

## License

MIT