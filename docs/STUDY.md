# STUDY.md — tasarım notları ve ölçümler

Bu dosya "neden böyle" sorusunun cevabı; ürün belgesi değil.

## 1. Neden dev köprüsü + headless Chrome

Tarayıcı oyunlarında en pahalı hata, "test geçti ama ekran boş" durumudur. Bu yüzden çekirdek
iki katmanlı doğrulanır:

- Mantık katmanı: canvas stub'ı ile Node'da (22 test, Chrome gerekmez).
- Görsel katman: gerçek Chrome'da, gerçek canvas pikseliyle (`run` senaryoları).

Köprü (`__KIVILCIM_DEV__`) yalnız `?dev=1` ile kurulur ve `@dev-start/@dev-end` bölgesindedir;
`build-check` bu bölgeyi üretim kopyasından çıkarır ve kalan dosyada köprü adı geçerse hata verir.
Ölçüm: kivilcim.mjs 33.852 → 33.098 bayt (−754), demo/index.html 5.666 → 4.720 (−946), sızıntı 0.

## 2. Determinizm

`RNG` (xorshift benzeri, tohumlu) `save/restore` ile kayıt dosyasına giriyor; `stateHash`
anahtar sırasından bağımsız (stableStringify + fnv1a). Test: aynı senaryo iki kez koşulduğunda
`stateHash` aynı (demo-smoke ve smoke koşuları: 17e88817). Kayıt/tekrar: 600 adım, 54 girdi,
`82ec2dc5 = 82ec2dc5`.

Sınır: hash simülasyon durumunu kapsar, çizim çıktısını kapsamaz. Görsel regresyon için
`capture` + sha256 kullanılır (ör. smoke-1.png cac40863…).

## 3. Kontrast ölçümü — ilk sürüm yanlıştı

İlk denemede `[10,10,320,100]` bölgesi için oran **1.00** çıktı, yani "metin yok" hükmü.
Sebep: %10/%90 yüzdelik dilim yöntemi. Bölgede 7200 pikselin yalnız ~%1.5'i metindi; %90
yüzdelik dilim zemine düşüyordu, iki değer de aynı parlaklığa gelince oran 1 oldu.

Düzeltme: histogram + "zemin = en sık parlaklık", "metin = toplam pikselin >=%0.5'i olan
kümelerin en parlağı". Sonuç: aynı bölge 16.67, sağ üst bölge 13.83 (eşik 4.5). Bu, gerçek
piksel dağılımıyla (metin rengi 248,208,120; 324 piksel) uyumlu.

Ders: eşik tabanlı ölçümlerde "ölçüm aracı bozuk mu" sorusu, "ürün kötü mü" sorusundan önce
sorulmalı. Bu yüzden `measureContrast` artık `bgLum`, `textLum`, `textShare` da döndürüyor —
oran düşerse sebebi rapor içinde görünür.

## 4. `drawn` kapısı

İlk eşik `unique > 64` idi ve gerçek çizimi (12 renk) "boş" saydı. Sahne koyu zemin + ızgara +
birkaç nesne olduğu için renk sayısı doğal olarak düşük. Eşik `>= 3` yapıldı; kapı artık
"tamamen tek renk değil" diyor. Bu kapı görsel doğruluğu değil, çizim varlığını kanıtlar;
görsel kabul için PNG'ye bakılır (smoke-1.png: SKOR 10, DALGA 1, CAN 3, oyuncu, 3 düşman,
mermi, ızgara — gözle doğrulandı).

## 5. Senaryo beklentileri gerçek koşudan

`demo-smoke` içinde `player.x > 600` yazmıştım; gerçek değer 236 çıktı. Sebep: 240 px/s hız,
60 tick = 240 px, başlangıç konumu ve arena sınırı. Beklenti `> 200` ve `< 960` olarak
gerçek davranışa göre yazıldı; uydurma eşik kalmadı.

Ayrıca `{"gt": 200, "lt": 960}` tek nesnede reddedildi (`Beklenti nesnesi tek karşılaştırıcı
içermeli`) — tasarım gereği; senaryo iki ayrı `expect` adımına bölündü.

## 6. Ölçülen kabul durumu

- `node tests/run.mjs` → PASS 22/22, çıkış 0.
- `run demo-smoke` → çıkış 0, stateHash 17e88817, PNG 22.737 bayt, kontrast 16.67.
- `run demo-balance` → çıkış 0, stateHash 0f958cca, PNG 22.540 bayt.
- `run demo-a11y` → çıkış 0, stateHash c4cc99f9, PNG 22.284 bayt, kontrast 16.67 / 13.83.
- `record --steps 600` → çıkış 0, 54 girdi, hash eşit.
- `build-check` → çıkış 0, sızıntı 0.
- `doctor` → çıkış 0 (Node 22+, WebSocket, Chrome bulundu).

## 7. Bilinen zayıflıklar

- FPS/frame ölçümü RAF sürücüsünde; headless `step()` koşusunda `stats.fps` anlamsız.
- `capture` PNG boyutu sahne doluluğuna bağlı; eşik 10 KB küçük sahnelerde sınırda kalabilir.
- `attach.mjs` yalnız pencere/global üzerinden bağlanır; iframe ve worker kapsam dışı.
- Kontrast DOM metnini ölçmez; HUD canvas'a çizildiği için bu demoda yeterli, gerçek üründe
  HTML menü varsa ayrı ölçüm gerekir.
