const wiraDb = require("@wira/shared/database/WiraDB");

const THINKING_FILLER_TEXT = {
    "hi-IN":
    [
        "एक सेकंड...",
        "हाँ, एक सेकंड...",
        "रुकिए ज़रा...",
        "हाँ बताती हूँ...",
        "एक सेकंड रुकिए...",
        "होल्ड करना ज़रा..."
    ],
    "en-IN":
    [
        "One second...",
        "Just a moment...",
        "Hold on please...",
        "Yeah, one sec...",
        "Bear with me...",
        "One moment please..."
    ],
    "bn-IN":
    [
        "এক সেকেন্ড...",
        "একটু দাঁড়ান...",
        "হ্যাঁ, এক পল...",
        "একটু থাকুন...",
        "এক সেকেন্ড প্লিজ...",
        "হোল্ড করুন একটু..."
    ],
    "gu-IN":
    [
        "એક સેકન્ડ...",
        "જરા રોકાઓ...",
        "હા, એક પળ...",
        "થોભો જરા...",
        "એક સેકન્ડ પ્લીઝ...",
        "હોલ્ડ કરો જરા..."
    ],
    "kn-IN":
    [
        "ಒಂದು ಸೆಕೆಂಡ್...",
        "ಸ್ವಲ್ಪ ತಡೀರಿ...",
        "ಹಾಂ, ಒಂದು ಕ್ಷಣ...",
        "ನಿಲ್ಲಿ ಜರಾ...",
        "ಒಂದು ಸೆಕೆಂಡ್ ಪ್ಲೀಸ್...",
        "ಹೋಲ್ಡ್ ಮಾಡಿ ಜರಾ..."
    ],
    "ml-IN":
    [
        "ഒരു സെക്കൻഡ്...",
        "ഒന്ന് നിൽക്കൂ...",
        "ഹാ, ഒരു നിമിഷം...",
        "പ്ലീസ് നിൽക്കൂ...",
        "ഒരു സെക്കൻഡ് പ്ലീസ്...",
        "ഹോൾഡ് ചെയ്യൂ ഒന്ന്..."
    ],
    "mr-IN":
    [
        "एक सेकंद...",
        "जरा थांबा...",
        "हाँ, एक क्षण...",
        "थांबा जरा...",
        "एक सेकंद प्लीज...",
        "होल्ड करा जरा..."
    ],
    "od-IN":
    [
        "ଏକ ସେକେଣ୍ଡ...",
        "ଟିକେ ଅଟକନ୍ତୁ...",
        "ହଁ, ଏକ ମୁହୂର୍ତ...",
        "ଦୟାକରି ରୁହନ୍ତୁ...",
        "ଏକ ସେକେଣ୍ଡ ପ୍ଲିଜ୍...",
        "ହୋଲ୍ଡ କରନ୍ତୁ ଟିକେ..."
    ],
    "pa-IN":
    [
        "ਇੱਕ ਸਕਿੰਟ...",
        "ਜ਼ਰਾ ਰੁਕੋ...",
        "ਹਾਂ, ਇੱਕ ਪਲ...",
        "ਰੁਕੋ ਜ਼ਰਾ...",
        "ਇੱਕ ਸਕਿੰਟ ਪਲੀਜ਼...",
        "ਹੋਲਡ ਕਰੋ ਜ਼ਰਾ..."
    ],
    "ta-IN":
    [
        "ஒரு நிமிஷம்...",
        "கொஞ்சம் இருங்க...",
        "ஆமா, ஒரு second...",
        "நில்லுங்க கொஞ்சம்...",
        "ஒரு நிமிஷம் please...",
        "hold பண்ணுங்க கொஞ்சம்..."
    ],
    "te-IN":
    [
        "ఒక్క సెకను...",
        "కొంచెం ఆగండి...",
        "హా, ఒక్క క్షణం...",
        "ఆగండి కొంచెం...",
        "ఒక్క సెకను ప్లీజ్...",
        "హోల్డ్ చేయండి కొంచెం..."
    ]
};

class DatabaseManager
{
    constructor(ttsConfig = {})
    {
        this.language = ttsConfig.languageCode ?? "hi-IN";
        this.speaker = ttsConfig.speaker ?? "anushka";
    }

    async getIdleAudio(text)
    {
        try
        {
            const row = await wiraDb.getWiraIntroAudio(text, this.language, this.speaker);

            if(!row)
            {
                console.error(`❌ [DB] No cached audio found for idle text: "${text}"`);
                return null;
            }

            return row.segments?.[0]?.audio ?? null;
        }
        catch(err)
        {
            console.error(`❌ [DB] getIdleAudio failed:`, err.message);
            return null;
        }
    }

    async getIdleAudioBatch(texts = [])
    {
        try
        {
            const rows = await Promise.all(texts.map(text => wiraDb.getWiraIntroAudio(text, this.language, this.speaker)));
            const audioMap = new Map(texts.map((text, i) => [text, rows[i]?.segments?.[0]?.audio ?? null]));

            return audioMap;
        }
        catch(err)
        {
            console.error(`❌ [DB] getIdleAudioBatch failed:`, err.message);
            return new Map();
        }
    }

    async insertCostBuckets(outboundScreeningId, costRecord)
    {
        try
        {
            if(!costRecord)
            {
                return;
            }

            const buckets = [...(costRecord.buckets ?? [])];

            const current = costRecord.currentBucket;
            const hasUnfinished = current && current.totalCost > 0 && current.startTime;

            if(hasUnfinished)
            {
                buckets.push(
                {
                    ...current,
                    endTime: new Date().toISOString()
                });
            }

            if(buckets.length === 0)
            {
                return;
            }

            await Promise.all(
                buckets.map((bucket, i) =>
                    wiraDb.insertWiraCallCost(
                    {
                        wiraOutboundScreeningId: outboundScreeningId,
                        bucketIndex: i,
                        startTime: bucket.startTime || new Date().toISOString(),
                        endTime: bucket.endTime || new Date().toISOString(),
                        ttsChars: bucket.ttsChars ?? bucket.sarvamTTS?.chars ?? 0,
                        ttsCost: bucket.ttsCost ?? bucket.sarvamTTS?.cost ?? 0,
                        sttSeconds: bucket.sttSeconds ?? bucket.sarvamSTT?.seconds ?? 0,
                        sttCost: bucket.sttCost ?? bucket.sarvamSTT?.cost ?? 0,
                        plivoSeconds: bucket.plivoSeconds ?? bucket.plivo?.seconds ?? 0,
                        plivoCost: bucket.plivoCost ?? bucket.plivo?.cost ?? 0,
                        geminiInputTokens: bucket.geminiInputTokens ?? bucket.gemini?.inputTokens ?? 0,
                        geminiCachedTokens: bucket.geminiCachedTokens ?? bucket.gemini?.cachedTokens ?? 0,
                        geminiOutputTokens: bucket.geminiOutputTokens ?? bucket.gemini?.outputTokens ?? 0,
                        geminiCost: bucket.geminiCost ?? bucket.gemini?.cost ?? 0,
                        bucketTotal: bucket.bucketTotal ?? bucket.totalCost ?? 0
                    })
                )
            );

            console.log(`✅ [DB] Inserted ${buckets.length} cost buckets for outboundScreeningId: ${outboundScreeningId}`);
        }
        catch(err)
        {
            console.error(`❌ [DB] insertCostBuckets failed:`, err.message);
        }
    }

    async getThinkingFillerAudio()
    {
        try
        {
            const texts = THINKING_FILLER_TEXT[this.language] ?? null;

            if(!texts)
            {
                console.error(`❌ [DB] No thinking filler text defined for language: "${this.language}"`);
                return null;
            }

            const text = texts[Math.floor(Math.random() * texts.length)];
            const row = await wiraDb.getWiraIntroAudio(text, this.language, this.speaker);

            if(!row)
            {
                console.error(`❌ [DB] No cached thinking filler audio for: "${text}" [${this.language}]`);
                return null;
            }

            return row.segments?.[0]?.audio ?? null;
        }
        catch(err)
        {
            console.error(`❌ [DB] getThinkingFillerAudio failed:`, err.message);
            return null;
        }
    }

    async updateCallStatus(wiraCallId, status)
    {
        try
        {
            await wiraDb.updateWiraCalls({ status }, { id: wiraCallId });
            console.log(`✅ [DB] Call status updated to "${status}" for wiraCallId: ${wiraCallId}`);
        }
        catch(err)
        {
            console.error(`❌ [DB] updateCallStatus failed:`, err.message);
        }
    }
}

module.exports = DatabaseManager;