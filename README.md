# WPBOT - WhatsApp DeepSeek AI Bot

Hedef WhatsApp grubunda, adinla seslenildiginde veya etiketlendiginde DeepSeek ile kisa ve dogal cevap veren bot.

## Ozellikler

- Adinla veya @etiket: her zaman cevap planlar
- Genel sohbet (naber arkadaslar vb.): AI son 15 mesaja bakip ara sira katilir
- Cevap hazirlanirken yeni mesaj gelirse plan iptal, son mesaja gore yeniden yazilir
- Sen yazdiktan sonra 2 dk icinde sana yanit/alinti gelirse: 10-45 sn icinde hizli cevap
- Normal mod: 15 sn - 10 dk arasi rastgele gecikme
- Son 15 mesaj `data/group-history.json` icinde
- DeepSeek prompt cache: sabit system prompt ile maliyet/latency optimizasyonu (`DEBUG=true` ile `[CACHE]` logu)
- Insanî cevap: zengin prompt + hafif post-processing (`humanize.js`)
- Sizi taklit ederek dogal, kisa cevaplar
- Oturumu kaydeder, tekrar baslatmada QR taramaya gerek kalmaz

## Gereksinimler

- Node.js v18.0.0 veya uzeri
- DeepSeek API anahtari (https://platform.deepseek.com)
- Bir WhatsApp hesabi

## Kurulum

1. Projeyi klonlayin veya dosyalari indirin:

```bash
cd WPBOT
```

2. Bagimliliklari yukleyin:

```bash
npm install
```

3. `.env` dosyasini olusturun:

```bash
cp .env.example .env
```

4. `.env` dosyasini duzenleyin:

| Degisken | Aciklama | Ornek |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API anahtariniz | `sk-xxxxxxxxxxxx` |
| `TARGET_GROUP_NAME` | Hedef WhatsApp grubunun adi | `Arkadaslar` |
| `USER_NAME` | Taklit edilecek kisi adi (seslenilince cevap) | `Ahmet` |
| `USER_NAME_ALIASES` | Ek isimler (virgulle) | `Maras,maraş` |
| `TARGET_GROUP_ID` | Grup ID (tercih edilir) | `120363...@g.us` |
| `DEEPSEEK_MODEL` | DeepSeek modeli (opsiyonel) | `deepseek-v4-flash` |
| `MIN_DELAY_MS` | Min gecikme ms (opsiyonel) | `15000` |
| `MAX_DELAY_MS` | Max gecikme ms (opsiyonel) | `600000` |
| `REPLY_MAX_TOKENS` | Cevap token limiti | `150` |
| `REPLY_TEMPERATURE` | Cevap yaratıcılığı (0-1) | `0.9` |
| `PERSONALITY_NOTES` | Ek kişilik notları | `gece uyku modunda` |
| `DEBUG` | Detaylı log + cache metrikleri | `true` |

## Kullanim

```bash
npm start
```

Terminalde bir QR kod goruntulenecektir. Telefonunuzdan WhatsApp > Bagli Cihazlar menusunden bu QR kodu taratin.

Baglanti basarili oldugunda bot calismaya baslayacaktir.

## Mesaj algilanmiyorsa

1. Botu baslatin; terminalde tum gruplarin adi ve ID'si listelenir.
2. `.env` icinde `DEBUG=true` yapin ve tekrar baslatin. Gelen her grup mesaji icin eslesme bilgisi gorunur.
3. `TARGET_GROUP_NAME` grubun adiyla birebir eslesmeli (bosluklar dahil). Daha guvenilir yol: `TARGET_GROUP_ID` kullanmak (listedeki ID'yi kopyalayin).
4. `TARGET_GROUP_ID` kullanmak en guvenilir yoldur.

## Onemli Uyarilar

- Bu botu kullanirken WhatsApp hesabinizin kapatilma riski bulunmaktadir. Kendi sorumlulugunuzda kullanin.
- Uzun sureli ve yuksek hacimli kullanimda, WhatsApp Web oturumunuz bloke edilebilir.
- Botunuzun dogal gorunmesi icin gecikme araligini cok dusuk ayarlamayin.

## Lisans

MIT
