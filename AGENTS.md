# AGENTS.md — KIVILCIM ajan sözleşmesi

Bu dosya, `kivilcim-runtime` deposunda çalışan kodlama ajanının (cd-coder, cd-denetmen, omp) uyacağı
sözleşmedir. Kural: **insan için panel, ajan için JSON.** Bir işi "oldu" diye kapatmadan önce aşağıdaki
komutlardan gerçek çıktı alınır; çıktı yoksa iş bitmemiştir.

Kaynak spec: `00-SISTEM/ceo-planlar/2026-11-04-kivilcim-runtime.md` (bölüm 2.2–2.5 ve 4).

---

## 1. Ortam (zorunlu)

- **Node >= 22** — CDP istemcisi yerleşik `WebSocket` kullanır. Daha eski sürümde `run` çalışmaz.
  Ölçülen ortam: Node v24.22.1.
- **Chrome/Chromium** — macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
  Farklı yol için `KIVILCIM_CHROME=/tam/yol` ortam değişkeni. Chrome yoksa `doctor` exit 1 verir,
  `run` çalışmaz; `tests/run.mjs` (canvas stub) yine çalışır.
- **npm YASAK.** `package.json` yok (varsa yalnız `{"type":"module"}`), `node_modules` yok,
  harici paket/font/asset yok. Glifler ve dokular kodla üretilir.
- Çalışma dizini depo kökü: `/Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime`
  (`/Volumes/EX/007-HERMES-M4-LIVE/12-PROJELER/kivilcim-runtime` ile aynı yer).

## 2. Komutlar

```
node cli/kivilcim.mjs doctor [--out out/doctor.json]        # ortam: node, WebSocket, Chrome yolu
node cli/kivilcim.mjs run <senaryo.json> [sayfa.html | --file <sayfa.html>] --out <dizin>   # gerçek Chrome'da senaryo koşusu + PNG + report.json
node cli/kivilcim.mjs inspect [sayfa.html | --file <sayfa.html>] --out <json>               # 30 adım sonrası durum anlık görüntüsü
node cli/kivilcim.mjs record --steps N --out <json>         # kayıt → tekrar oynatma hash eşitliği
node cli/kivilcim.mjs build-check --write <dizin> [--file <html>]   # dev kodu sızıntısı + boyut raporu
node tests/run.mjs                                          # mantık testleri (Chrome gerekmez)
```

Notlar (gerçek davranış):
- `run` çıktısını her durumda JSON olarak stdout'a basar; `--json` bayrağı kabul edilir ama ek bir
  etkisi yoktur (parseArgs tanır, cmdRun JSON'u zaten yazar).
- `run --out` verilmezse `out/run-<timestamp>` dizini kullanılır.
- Her `run` çağrısı yeni bir headless Chrome açar ve kapatır; eşzamanlı koşu için ayrı `--out` dizini ver.

## 3. `run` çıktısı JSON şeması (out/<dizin>/report.json)

```json
{
  "ok": true,
  "scenario": "demo-smoke",
  "steps": 11,
  "stepsRun": 4,
  "stateHash": "17e88817",
  "flashes": 0,
  "contrast": [
    { "rect": [10,10,320,100], "ratio": 16.67, "ok": true, "threshold": 4.5,
      "bgLum": 0.004, "textLum": 0.85, "textShare": 0.0154 }
  ],
  "failures": [],
  "gates": [],
  "captures": [
    { "name": "smoke-1", "step": 8, "file": "<mutlak yol>/smoke-1.png", "bytes": 22737,
      "sha256": "cac40863fd145109f35eccc5dfbce829ced1141e0514738665c8e2fc2f0ea59d",
      "unique": 12, "nonuniform": true, "gte10k": true, "drawn": true }
  ],
  "snapshot": { "scene": "arena", "tick": 92, "time": 1.533333, "params": {}, "state": {},
                "events": {}, "stats": {}, "dev": true }
}
```

Zorunlu alanlar ve anlamları:
- `ok` — yalnız senaryo ihlali yok **ve** kapılar temizse `true`. `gates` boş değilse `ok` daima `false`.
- `scenario`, `steps` (senaryodaki adım sayısı), `stepsRun` (fiilen yürüyen adım sayısı).
- `stateHash` — simülasyon durumunun determinizm kanıtı (fnv1a, anahtar sırasından bağımsız).
- `failures[]` — `{step, op, path, expected:{op,value}, actual, hint, ne, nerede, ne_yapmali}`.
  Her kayıt "ne oldu / nerede oldu / ne yapmalı" üçlüsünü taşır; ajan bu metinden düzeltmeyi çıkarır.
- `captures[]` — PNG gerçekten çizilmiş mi: `bytes >= 10000`, `nonuniform === true`, `sha256`.
  Boş/tek renk PNG kapıyı düşürür.
- `contrast[]` — WCAG ölçümü; `ratio >= 4.5` şart, `bgLum/textLum/textShare` sebep göstergesi.
- `snapshot` — koşu sonundaki `inspect.snapshot()` (scene, tick, params, state, events, stats, dev).

## 4. Exit code sözleşmesi

| kod | anlam | örnek |
|---|---|---|
| 0 | PASS — senaryo geçti, kapılar temiz, artefaktlar üretildi | `run` ok:true, `tests` PASS n/n, `doctor` hazır |
| 1 | FAIL — kabul ölçütü düştü (assert ihlali, kontrast < 4.5, PNG < 10 KB, hash farkı, dev sızıntısı, doctor eksik ortam) | bozuk senaryo, `record` hash eşit değil |
| 2 | KULLANIM / ARAÇ HATASI — eksik argüman, geçersiz senaryo biçimi, JSON parse, dosya yok | `run` senaryosuz çağrı |
| 3 | RUNTIME / CHROME HATASI — Chrome başlamadı, CDP koptu, sayfa yüklenemedi | Chrome kapalı/port kapalı |
| 4 | ARTEFAKT EKSİK — beklenen PNG/rapor diske yazılamadı veya boş | out dizini yazılamıyor |

**Gerçek durum (dürüst not):** mevcut CLI kodu 0, 1 ve 2 üretiyor. Chrome/CDP ve dosya hataları şu an
`fail()` üzerinden **2**'ye düşüyor; **3 ve 4 ayrımı henüz kodda yok** (spec 2.4 ile fark, cd-denetmen
denetim konusu). Bu tablo sözleşmedir; kod 3/4'ü üretmeye başladığında bu not kaldırılır.

## 5. Determinizm (pazarlık dışı)

- Simülasyon kodunda **`Math.random`, `Date.now`, `performance.now` YASAK**. Rastgelelik yalnız
  `game.random` (`RNG`, tohumlu, `save/restore`) üzerinden gelir. `tests/run.mjs` bunu kaynak taramasıyla
  denetler; tarama gerçekten dosyaları okur, "geçti" varsayımı yoktur.
- Zaman yalnız `game.step(n)` / `wait` ile ilerler. Senaryoda duvar saati beklenmez, `wait` **adım sayısıdır**.
- **Aynı seed + aynı senaryo → aynı `stateHash`.** Kanıt: aynı senaryo iki kez koşulur, hash'ler
  karşılaştırılır ve `out/determinism.log`'a yazılır. Fark varsa iş FAIL'dir; "yaklaşık aynı" kabul edilmez.
- Kayıt/tekrar: `record` hash'i kayıt hash'iyle eşit olmalı.
- `stateHash` simülasyon durumunu kapsar, çizimi kapsamaz; görsel regresyon için `capture` + `sha256` kullan.

## 6. Dev sınırı

- `__KIVILCIM_DEV__` köprüsü **yalnız** `?dev=1` sorgu parametresi veya
  `globalThis.__KIVILCIM_DEV_FLAG__ === true` iken kurulur. Varsayılan: kapalı.
- Köprü adı kaynakta yalnız `@dev-start` / `@dev-end` işaretli bölgede geçer. `build-check` bu bölgeyi
  üretim kopyasından çıkarır ve kalan metinde köprü adı geçerse hata verir (`devLeak`).
- Üretim bundle'ında dev kodu, dev paneli, `?dev=1` varsayımı bulunmaz. `run`/`inspect`/`record`
  senaryo koşuları köprüyü kendileri kurar; bu bir üretim sızıntısı değildir.

## 7. Senaryo adımları ve `expect` yolları

Adımlar (`scenario.mjs` `OPS` listesi): `wait`, `press`, `release`, `tap`, `pointer`, `set`, `expect`,
`until`, `command`, `capture` (`screenshot` eş adı), `contrast`, `flashes`, `viewport`, `reducedMotion`.

```json
{"name":"demo-smoke","viewport":[960,540],"reducedMotion":false,"seed":42,"steps":[
  {"wait":30},
  {"press":"ArrowRight"},{"wait":60},{"release":"ArrowRight"},
  {"expect":{"scene":"arena","state.player.x":{"gt":200}}},
  {"set":{"player.speed":400}},
  {"until":{"events.waveCleared":{"gte":1}},"within":600},
  {"command":"spawnWave","args":[3]},
  {"capture":"after-wave"},
  {"contrast":[10,10,320,100]},
  {"flashes":120}
]}
```

- `expect` / `until` yolları **snapshot köküne** görelidir: `scene`, `tick`, `time`,
  `params.<grup>.<anahtar>`, `state.*`, `events.<olay>`, `stats.fps`, `dev`.
  Örnek geçerli yollar: `state.player.x`, `events.enemyDown`, `params.player.speed`, `tick`.
- Karşılaştırıcılar: `eq`, `gt`, `gte`, `lt`, `lte`, `approx`. **Bir `expect` nesnesi tek karşılaştırıcı
  içerir**; iki sınır gerekiyorsa iki ayrı adım yazılır (`{"gt":200,"lt":960}` reddedilir).
- `until` + `within` olay sayacıyla bekler; `within` adım sayısıdır, süre değil.
- `contrast` bölgesi `[x,y,w,h]` mantıksal pikseldir ve eşik 4.5:1'dir; `flashes` parlaklık sıçraması sayısıdır.
- Bilinmeyen işlem adımı `SCENARIO_OP` hatası verir; geçerli liste hata mesajında yazılır.

## 8. Yasaklar

1. `npm install` / `package.json` bağımlılığı eklemek.
2. Sim kodunda `Math.random`, `Date.now`, `performance.now` kullanmak.
3. Senaryoda duvar saati beklemek (`setTimeout`, `wait` yerine süre).
4. Bir `expect` nesnesine birden fazla karşılaştırıcı koymak.
5. Üretim yolunda dev köprüsünü açık bırakmak veya `@dev-start/@dev-end` dışına köprü adı yazmak.
6. Beklenti eşiğini "test geçsin" diye gerçek ölçüme bakmadan değiştirmek (uydurma eşik).
7. Test/koşu çıktısı görmeden "geçti" demek; build başarısını davranış kanıtı saymak.
8. Chrome'u başsız olmayan modda açıp ekrana pencere bırakmak (`--headless=new` zorunlu).
9. Harici font/asset/CDN eklemek (glifler kodla üretilir).
10. Başka vakanın verisini bu depoya taşımak; `out/` altındaki eski koşuları kanıt yerine koymak.

## 9. Teslim kanıtı (iş kapatma ölçütü)

Bir iş ancak şu dört kanıt birlikte varsa kapatılır:

1. **Komut + gerçek çıktı**: çalıştırılan komut satırı, stdout/stderr'in ilgili kısmı, exit code.
2. **Determinizm**: aynı senaryo iki koşu → `stateHash` eşit; karşılaştırma `out/determinism.log`'da.
3. **Görsel/ölçüm**: `captures[]` içinde `bytes >= 10000`, `nonuniform:true`, `sha256`; `contrast.ratio >= 4.5`.
4. **Dosya yolu**: üretilen artefaktların mutlak yolları (`out/<dizin>/report.json`, PNG, log).

Ek kapılar: `node tests/run.mjs` → `PASS n/n` ve exit 0; `build-check` → `devLeak:false`;
`doctor` → Chrome bulundu. Kanıt dosyaları `out/` altında kalır, özet README'ye yazılır.

Bağımsız kabul: kodu yazan ajan kendi PASS'ını ilan eder, **cd-denetmen** ayrı oturumda spec↔kod uyumunu,
determinizm iddiasının gerçekten ölçüldüğünü ve dev-leak taramasının gerçekten taradığını denetler.
