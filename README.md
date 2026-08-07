# WPBOT — WhatsApp 1-1 DeepSeek Bot

Belirli bir kişiyle **bire bir (DM)** sohbette, DeepSeek AI ile kısa ve doğal (veya absürt / kara mizah) cevap veren bot.

Grup mesajlarını dinlemez; sadece `.env` içindeki hedef kişiyle özel sohbete cevap verir.

## Özellikler

- **1-1 mod:** Sadece hedef kişinin DM mesajlarına cevap
- Hedef eşleştirme: telefon numarası (`TARGET_PERSON_NUMBER`) ve/veya LID (`TARGET_PERSON_LID`)
- Hedef kişiden gelen **her mesaja** cevap planlanır (grup “katılayım mı?” kararı yok)
- Cevap beklerken yeni mesaj gelirse plan iptal edilir, son mesaja göre yeniden yazılır
- Sen yazdıktan sonra 2 dk içinde yanıt gelirse **hızlı cevap** penceresi (varsayılan 10–60 sn)
- Normal gecikme: rastgele 15 sn – 2 dk
- Ardışık mesajlar debounce ile birleştirilir
- Sohbet geçmişi `data/group-history.json` içinde saklanır
- Açılışta DM listesi + `TARGET_PERSON_LID` bulma yardımı
- Oturum kaydı: tekrar başlatmada genelde QR gerekmez
- Persona notları: yerel `data/personas.json` (örnek: `personas.example.json`) + `PERSONALITY_NOTES`

## Gereksinimler

- Node.js **v18+**
- [DeepSeek API](https://platform.deepseek.com) anahtarı
- Bir WhatsApp hesabı (WhatsApp Web ile giriş)

## Kurulum

```bash
cd WPBOT
npm install
cp .env.example .env   # Windows: copy .env.example .env
cp data/personas.example.json data/personas.json
```

`.env` ve `data/personas.json` dosyalarını kendi bilgilerinle düzenle.

> **Gizlilik:** Gerçek `data/personas.json`, `.env`, sohbet geçmişi ve DM listesi git’e **girmez** (`.gitignore`). Repoda yalnızca örnek dosyalar vardır.

## .env ayarları

### Zorunlu / önemli

| Değişken | Açıklama | Örnek |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API anahtarı | `sk-...` |
| `TARGET_PERSON_NUMBER` | Hedef telefon (ülke koduyla, boşluksuz) | `905551112233` |
| `TARGET_PERSON_NAME` | Hedef isim (log + hitap) | `Ali Veli` |
| `TARGET_PERSON_LID` | WhatsApp LID id (telefon eşleşmezse) | `1234...@lid` |
| `USER_NAME` | Botun taklit ettiği isim | `Maraş` |
| `USER_NAME_ALIASES` | İsim varyantları (virgülle) | `Maraş,Maras,maraş` |

`TARGET_PERSON_NUMBER` **veya** `TARGET_PERSON_LID` tanımlı olmalı.

### Kişilik / model

| Değişken | Açıklama |
|---|---|
| `PERSONALITY_NOTES` | Prompta eklenen kişilik notları |
| `DEEPSEEK_MODEL` | Ana model (varsayılan `deepseek-v4-flash`) |
| `DEEPSEEK_NON_THINKING_MODEL` | Thinking boş dönerse yedek model |
| `REPLY_TEMPERATURE` | Yaratıcılık (1-1 troll için yüksek olabilir, örn. `1.1`) |
| `REPLY_MAX_CHARS` | WhatsApp’a giden max karakter |
| `DEBUG` | `true` ise ek debug logları |

### Zamanlama

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | 15000 / 120000 | Normal cevap gecikmesi |
| `FAST_REPLY_WINDOW_MS` | 120000 | Sen yazdıktan sonra “hızlı mod” süresi |
| `MIN_FAST_DELAY_MS` / `MAX_FAST_DELAY_MS` | 10000 / 60000 | Hızlı mod gecikmesi |
| `MESSAGE_DEBOUNCE_MS` | 3500 | Ardışık mesajları birleştirme |
| `HISTORY_SIZE` | 50 | Saklanan geçmiş uzunluğu |
| `REPLY_CONTEXT_SIZE` | 30 | AI’ya verilen son mesaj sayısı |
| `STARTUP_FETCH_LIMIT` | 50 | Açılışta çekilecek mesaj sayısı |

## Personas (`data/personas.json`)

Hedef (veya bilinen) kişiye özel prompt ipuçları. Bot, mesajın telefonuna göre eşleşen persona’yı DeepSeek promptuna ekler.

**Kurulum:**

```bash
cp data/personas.example.json data/personas.json
# Windows: copy data\personas.example.json data\personas.json
```

Dosya yoksa bot çalışır; sadece kişiye özel `hint` eklenmez (`PERSONALITY_NOTES` yine geçerli).

### Format

```json
{
  "personas": [
    {
      "phones": ["905551112233", "5551112233"],
      "name": "Ali",
      "mode": "troll",
      "hint": "Bu kişiye nasıl davranılacağına dair kısa not..."
    }
  ]
}
```

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `phones` | evet | Eşleşecek numaralar (ülke kodlu + kısa form). LID user kısmı da eklenebilir. |
| `name` | evet | Hitap / log adı |
| `mode` | evet | `troll` \| `roast` \| `normal` |
| `hint` | evet | AI’ya giden kişi notu (Türkçe, kısa ve net) |

**`mode` farkı:**

- `troll` — full taşşak; geçmiş sorularında saçmalama vurgusu
- `roast` — arkadaşça ara sıra takılma (her mesajda değil)
- `normal` — düz samimi muhabbet, dalga yok

1-1 kullanımda genelde tek persona yeter: hedefinin numarasını `phones` içine yaz, `mode` + `hint`’i ayarla. Örnek dosyadaki Ali / Ayşe / Mehmet uydurmadır.

## Kullanım

```bash
npm start
```

1. Terminalde QR kod çıkar.
2. Telefonda **WhatsApp → Bağlı Cihazlar** ile QR’ı tara.
3. Bağlanınca bot hedef kişiyi arar ve (moduna göre) geçmişi yükler / cevap planlar.

Başlangıçta konsolda **`[LISTE]`** ile özel sohbetler listelenir; eşleşenler `>>>` ile işaretlenir. Liste ayrıca `data/dm-list.txt` dosyasına yazılır.

Telefon eşleşmiyorsa listedeki `id` değerini `.env` içine koy:

```env
TARGET_PERSON_LID=12345678901234@lid
```

## Başlangıç modları (`STARTUP_MODE`)

PM2 restart / güncelleme sonrası kaçırılan mesajlar için:

| Mod | Ne yapar |
|-----|----------|
| `idle` | Sadece yeni mesajları dinler |
| `sync` | Son mesajları geçmişe yazar, cevap vermez |
| `reply_last` | Son gelen mesajı okur ve normal kurallarla cevap planlar |

```env
STARTUP_MODE=reply_last
STARTUP_MAX_AGE_MS=600000
```

`STARTUP_MAX_AGE_MS`: `reply_last` için son mesaj bu süreden (ms) eskiyse cevap yok (varsayılan 10 dk).

**Tek seferlik:**

```bash
npm run start:sync
npm run start:reply-last
# veya
node bot.js --startup idle
node bot.js --startup sync
node bot.js --startup reply_last
```

**PM2 örneği:**

```bash
pm2 start bot.js --name wbot
pm2 restart wbot --update-env
```

`ecosystem.config.cjs` varsa:

```bash
pm2 start ecosystem.config.cjs --env restart
```

## Hedef kişi bulunamazsa

1. Botu bir kez çalıştır; `[LISTE]` / `data/dm-list.txt` çıktısına bak.
2. Hedef sohbetin `id` değerini `TARGET_PERSON_LID` olarak yaz.
3. `TARGET_PERSON_NUMBER` ülke koduyla, boşluksuz olsun (`905xxxxxxxxx`).
4. `DEBUG=true` yapıp neden atlandığını logdan kontrol et.
5. Hedef kişiyle WhatsApp’ta en az bir kez sohbet açılmış olmalı (DM listesinde görünür).

## Nasıl çalışır (kısa)

1. Gelen DM hedef kişiye ait mi diye bakılır (LID / telefon).
2. Mesaj geçmişe eklenir; debounce sonrası cevap planlanır.
3. Rastgele gecikme (veya hızlı pencere) sonrası DeepSeek cevap üretir.
4. Cevap insanileştirilip (`humanize.js`) karakter limitiyle gönderilir.
5. Plan beklerken yeni mesaj gelirse bekleyen cevap iptal edilir.

## Önemli uyarılar

- WhatsApp hesabının kapanma / kısıtlanma riski vardır; kendi sorumluluğunda kullan.
- Çok düşük gecikme ve yüksek mesaj hacmi ban riskini artırır.
- Bu araç resmi WhatsApp Business API değildir (`whatsapp-web.js` kullanır).

## Lisans

MIT
