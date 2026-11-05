# kivilcim-runtime

Tarayıcıda çalışan, **deterministik** ve **headless doğrulanabilir** küçük oyun çekirdeği.
Amaç: oyun kodunu "çalışıyor gibi görünüyor" demeden, gerçek Chrome'da koşturup
durum hash'i, ekran görüntüsü ve kontrast ölçümüyle kanıtlamak.

Bağımlılık yok. Node >= 22 (yerleşik `WebSocket`), sistemde Chrome/Chromium.

## Hızlı başlangıç

```
node cli/kivilcim.mjs doctor
node cli/kivilcim.mjs run scenarios/demo-smoke.json --out out/smoke
node cli/kivilcim.mjs inspect --out out/inspect.json
node cli/kivilcim.mjs record --steps 600 --out out/replay.json
node cli/kivilcim.mjs build-check --write out/build
node tests/run.mjs
```

Oynanabilir demo (dev köprüsü açık):

```
node cli/kivilcim.mjs doctor     # chrome yolunu yazar
# herhangi bir statik sunucu ile:
python3 -m http.server 8000      # sonra http://127.0.0.1:8000/demo/index.html
```

`?dev=1` dev köprüsünü (`globalThis.__KIVILCIM_DEV__`) kurar; `?headless=1` döngüyü durdurur.
Üretimde `?dev=1` yoksa köprü kurulmaz.

## CLI komutları ve çıkış kodları

| komut | ne yapar | çıkış |
|---|---|---|
| `doctor` | Node sürümü, WebSocket, Chrome yolu | 0 hazır / 1 eksik |
| `run <senaryo> --out <dizin>` | senaryoyu gerçek Chrome'da koşar, PNG + report.json yazar | 0 kabul / 1 ihlal |
| `inspect --out <json>` | 30 adım sonrası durum anlık görüntüsü | 0 |
| `record --steps N --out <json>` | kayıt → tekrar oynatma hash eşitliği | 0 eşit / 1 farklı |
| `build-check --write <dizin>` | `@dev-start/@dev-end` bölgelerini üretim kopyasından çıkarır, sızıntı arar | 0 temiz / 1 sızıntı |

`run` çıktısındaki kapılar: PNG >= 10 KB, `drawn` (>=3 farklı renk), senaryo ihlali yok,
kontrast >= 4.5. Kapılardan biri düşerse çıkış kodu 1'dir ve `gates` dizisinde nedeni yazar.

## Senaryo biçimi

```json
{
  "name": "smoke",
  "seed": 42,
  "steps": [
    { "wait": 30 },
    { "press": "ArrowRight" },
    { "wait": 60 },
    { "release": "ArrowRight" },
    { "expect": { "state.player.x": { "gt": 200 } } },
    { "capture": "smoke-1" },
    { "contrast": [10, 10, 320, 100] }
  ]
}
```

Adımlar (`scenario.mjs` `OPS`): `wait`, `press`, `release`, `tap`, `pointer`, `set`, `expect`,
`until`, `command`, `capture` (`screenshot` eş adı), `contrast`, `flashes`, `viewport`, `reducedMotion`.
`expect` tek karşılaştırıcı alır: `eq`, `gt`, `gte`, `lt`, `lte`, `approx`; iki sınır gerekiyorsa iki ayrı
`expect` yazılır. `until` + `within` olay sayacıyla bekler; `within` adım sayısıdır, duvar saati değil.

## API (özet)

```js
import { Game } from './kivilcim.mjs';
const game = new Game({ canvas, seed: 42, search: location.search, storageNS: 'oyun' });
game.addScene({ id: 'arena', enter, update(dt), render(), inspect() { return {...} } });
game.params.define('oyun', { hiz: { type: 'number', min: 1, max: 10, default: 5 } });
game.inspect.register('player', () => ({ x: player.x, y: player.y }));
game.invokeCommand('resetRun');
game.start();
```

Determinizm sözleşmesi: simülasyon kodu `Math.random`, `Date.now`, `performance.now`
kullanmaz (test bunu tarar). Rastgelelik yalnız `game.random` (`RNG`) üzerinden gelir ve
kayıt/tekrar oynatma RNG durumunu da taşır.

Kayıt: `game.startRecording()` → `game.step(n)` → `game.stopRecording()` → `game.replay(rec)`.
`replay` dönen hash, kaydın `stateHash` değeriyle eşit olmak zorundadır.

## Gerçek koşu kanıtları

Bu depodaki son koşuların çıktıları `out/` altında; özet `out/acceptance.json`.
Aşağıdaki sayılar 2026-11-04 12:17 koşusundan (`out/kabul2/`) alınmıştır, tahmin değildir.

| senaryo | sonuç | stateHash | PNG |
|---|---|---|---|
| demo-smoke | geçti (exit 0) | 17e88817 | 21.230 bayt, sha256 a126a499…, nonuniform=true |
| demo-balance | geçti (exit 0) | 0f958cca | 21.673 bayt, sha256 818ab8d0…, nonuniform=true |
| demo-a11y | geçti (exit 0) | c4cc99f9 | 21.095 bayt, sha256 fea7809a…, nonuniform=true |
| demo-smoke 2. koşu | hash eşit | 17e88817 = 17e88817 | PNG sha256 da eşit |
| record 600 adım | hash eşit | 82ec2dc5 = 82ec2dc5 | — |
| birim testler | PASS 22/22, exit 0 | — | — |
| build-check | temiz, devLeak=false | — | kivilcim.mjs 33.852→33.098, demo/index.html 5.666→4.720 |
| doctor | hazır, exit 0 | — | Node 24.22.1, WebSocket var, Chrome bulundu |
| bozuk senaryo | exit 1 (beklenen) | — | gates: "hiç capture yok", "senaryo başarısız: 1 ihlal" |

Kontrast ölçümü (a11y senaryosu): HUD bölgesi `[10,10,320,100]` oranı 16.07, sağ üst
bölge `[740,16,200,44]` oranı 13.34 (eşik 4.5). Ölçüm canvas pikselinden yapılır;
DOM tabanlı metinler kapsam dışıdır.

## Ölçekleme (canvas ↔ viewport)

Canvas sabit 960x540'a mahkûm değil; gerçek viewport'a göre ölçeklenir. Sınır: **mantıksal dünya ve
simülasyon birimleri değişmez**, yalnız piksel arabelleği ve CSS ölçüsü uyarlanır (oyun dengesi/özellik
değişikliği yok).

```js
const fit = game.fitToViewport({ vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio });
// fit: { mode:'cover', world:[960,540], buffer:[1280,720], css:[1280,720], cover:1.333, scale:[...], vw, vh, dpr }
```

- Arabellek: viewport×dpr; **alt sınır 960x540, üst sınır 1920x1080** (ölçek 1..2'ye kırpılır, en-boy
  oranı korunur). CSS: **kapak (cover)** — viewport'u doldurur, letterbox yok, taşan kısım merkezden kırpılır.
- `game.visibleWorld()` kapak ölçekte gerçekten görünen dünya dikdörtgenini verir; HUD ve oyun sonu kutusu
  buna yerleşir, kırpılan bölgeye yazı çizilmez (dikey ekranda skor/can görünür kalır).
- Dokunmatik girdi sim kodu değiştirmeden mevcut girdi hattına çevrilir: sol yarı `ArrowLeft`, sağ yarı
  `ArrowRight`, dokunuş `Space` (`game.input.inject`). `Input.dispatchTouchEvent` bu dinleyiciler üzerinden
  oyunu gerçekten sürer; yalnız viewport küçültmek kabul edilmez.
- Ölçüm: 1280x720 ve 390x844'te `canvas.getBoundingClientRect().width >= viewport genişliği`; arabellek
  960x540..1920x1080 aralığında. Test: `tests/run.mjs` #25 (ölçekleme sim durumu hash'ini değiştirmemeli).

## Dosyalar

```
kivilcim.mjs      çekirdek: Game, RNG, Params, Inspect, Input, Draw, Storage, hash, dev köprüsü
scenario.mjs      senaryo koşucusu, karşılaştırıcılar, kontrast ölçümü
attach.mjs        motor bağımsız köprü (pencere/global üzerinden bağlanır)
cli/cdp.mjs       Chrome başlatma + minimal CDP istemcisi (WebSocket)
cli/kivilcim.mjs  komut satırı
demo/             oynanabilir demo (arena) ve dev paneli
scenarios/        demo-smoke, demo-balance, demo-a11y
tests/run.mjs     mantık testleri (canvas stub ile, Chrome gerekmez)
tools/acceptance.mjs  out/ çıktılarından kabul özeti üretir
```

## Sınırlar (dürüst liste)

- Kontrast ve capture yalnız canvas pikselini ölçer; HTML/CSS ile çizilen menüler ölçülmez.
- `drawn` kapısı "en az 3 farklı renk" der; oyunun görsel olarak doğru olduğunu değil,
  boş olmadığını kanıtlar. Görsel kabul için PNG'ye bakılmalıdır.
- Headless Chrome gereklidir; Chrome yoksa `run` çalışmaz, `tests/run.mjs` çalışır.
- Demo küçük bir arena; tam oyun değil, çekirdeğin kullanım örneğidir.
- `build-check` yalnız işaretli bölgeleri kırpar; minify/bundle yapmaz.
