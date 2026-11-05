# KIVILCIM runtime — Kabul Raporu (iş 1104-1850c1)

Kök iş: 1104-b6717b · Adım: 3/4 (Demo oyun + 3 senaryo, Bölüm 3 kabul kanıtları)
Tarih: 2026-11-04T12:01:04 · Sonuç: **PASS** (10/10)

## Kabul maddeleri ve gerçek çıktı

| # | Komut | Exit | Sonuç | Gerçek kanıt |
|---|-------|------|-------|--------------|
| 1 | `node tests/run.mjs` | 0 | GEÇTİ | PASS 22/22 |
| 2 | `node cli/kivilcim.mjs run scenarios/demo-smoke.json --json --out out/kabul/smoke1` | 0 | GEÇTİ | ok=true, stateHash=17e88817, capture 21230 bayt nonuniform=True |
| 3 | aynı komut 2. kez (determinism) | 0 | GEÇTİ | hash1=17e88817 hash2=17e88817 eşit=True, PNG sha eşit=True |
| 4 | `node cli/kivilcim.mjs run scenarios/demo-a11y.json --json --out out/kabul/a11y` | 0 | GEÇTİ | ok=true, kontrast 16.07:1 ve 13.34:1 (eşik 4.5), flashes=0 |
| 5 | `node cli/kivilcim.mjs run scenarios/demo-balance.json --json --out out/kabul/balance` | 0 | GEÇTİ | ok=true, skor=70, events={"runReset": 1, "waveSpawned": 2, "shotFired": 9, "enemyDown": 7, "waveCleared": 1} |
| 6 | `node cli/kivilcim.mjs build-check demo/index.html` | 0 | GEÇTİ | devLeak=false (5 dosya), leaks=[] |
| 7 | `node cli/kivilcim.mjs run tests/fixtures/bad.json --json --out out/kabul/bad` | 1 (beklenen) | GEÇTİ | ok=false, gates=["hiç capture yok", "senaryo başarısız: 1 ihlal"], hata metni: tick beklenen koşulu sağlamıyor: beklenen gt 99999, gerçek 5 / senaryo "bad-fixture", adım 1 (expect) |
| 8 | `node cli/kivilcim.mjs doctor` | 0 | GEÇTİ | ok=true, node 24.22.1, webSocket True |
| 9 | PNG bağımsız çözüm (zlib/IDAT) + görsel inceleme | — | GEÇTİ | 960x540 RGBA, 21230 bayt, 188 farklı renk, parlaklık 12.7–237.4 |
| 10 | `node dist/kivilcim.mjs doctor` + dist smoke | 0 | GEÇTİ | üretim kopyası çalışıyor, dist sha b26f5c7b000f6373 |

## Bu adımda yapılan değişiklik

- `demo/game.mjs`: HUD üst bandı (0,0,960,112) opak çiziliyor + alt ayırıcı çizgi. Önce düşman sprite'ları sağ üstteki "EN İYİ" metninin üzerine biniyordu; artık HUD metinleri her zaman net, kontrast 13.34:1 (eşik 4.5).
- `dist/` üretim kopyası `build-check --write dist` ile yeniden üretildi; doctor ve smoke koşusu dist üzerinden de geçti.

## Senaryolar

- `scenarios/demo-smoke.json` — temel akış (hareket, ateş, isabet, skor)
- `scenarios/demo-a11y.json` — kontrast + flash denetimi (40 adım)
- `scenarios/demo-balance.json` — dalga/denge (waveSpawned, enemyDown, waveCleared)

## Dosya yolları

- Kabul JSON: /Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/out/kabul/ACCEPTANCE-1104-1850c1.json
- Kanıt logları: /Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/out/kabul/
- Capture'lar: /Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/out/kabul/smoke1/smoke-1.png, /Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/out/kabul/a11y/a11y-1.png, /Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/out/kabul/balance/balance-1.png
- Dosya listesi + sha256: /Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/out/DOSYA-LISTESI.json
- Determinism: /Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/out/determinism.log

## Kalan risk

- Demo Chrome ile headless koşuyor; farklı Chrome sürümünde kontrast ölçümü küçük sapabilir (ölçülen değerler eşiğin çok üstünde).
- `flashes=0` ölçüldü; bu "hiç flash yok" demek, eşik aşılmadı.

## Birleşik doğrulama (iş 1104-5ddd3c)

Kök iş 1104-b6717b'nin tüm beklenen çıktıları bu oturumda yeniden koşuldu: 10/10 kabul maddesi PASS
(tests 22/22, smoke determinizm hash eşit 17e88817, a11y kontrast 16.07/13.34, balance speed=400,
build-check devLeak=false, bozuk senaryo exit 1 + Türkçe teşhis, doctor ok, bağımsız PNG denetimi, replay hash eşit).

- Birleşik rapor: /Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/out/kabul-1104-5ddd3c/BIRLESIK-KABUL-1104-5ddd3c.md
- Makine okunur özet: /Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/out/kabul-1104-5ddd3c/OZET-1104-5ddd3c.json
- Bu birleştirmede koda tek dokunuş: `cli/kivilcim.mjs` build-check raporuna üst düzey `devLeak` alanı eklendi (spec 3/6 birebir karşılanması için).
