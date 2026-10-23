/**
 * Interview Reminder Prompts & Eligibility Evaluation
 * 
 * Defines the conversational AI guidelines, intro text generation,
 * eligibility criteria evaluation, and tag parser for interview reminder calls.
 */

function evaluateScreeningEligibility(screeningData = {}, callData = {})
{
    const score = Number(screeningData?.score ?? 0);
    const jobInterest = String(screeningData?.jobInterest ?? "").toUpperCase();
    const callInterest = String(callData?.interest ?? "").toUpperCase();
    const hangupCause = String(screeningData?.hangupCause ?? callData?.hangupCause ?? "").toLowerCase();

    // 1. Score threshold check: must be >= 50%
    const isScoreQualified = score >= 50;

    // 2. Interest check: must be MEDIUM or HIGH
    const validInterests = ["MEDIUM", "HIGH", "MED", "INTERESTED"];
    const isInterestQualified = validInterests.includes(jobInterest) || validInterests.includes(callInterest);

    // 3. Disqualification / fulfillment check from screening call
    const disqualifiedCauses = [
        "candidate_not_interested",
        "candidate_already_placed",
        "language_barrier",
        "no_response"
    ];
    const isFulfilled = !disqualifiedCauses.includes(hangupCause);

    let reason = "Qualified";
    if (!isScoreQualified)
    {
        reason = `Screening score ${score}% is below required 50% threshold`;
    }
    else if (!isInterestQualified)
    {
        reason = `Candidate interest level (${jobInterest || callInterest || "NONE"}) is not MEDIUM or HIGH`;
    }
    else if (!isFulfilled)
    {
        reason = `Candidate disqualified in previous screening call due to hangup cause: ${hangupCause}`;
    }

    return {
        qualified: isScoreQualified && isInterestQualified && isFulfilled,
        reason: reason,
        score: score,
        jobInterest: jobInterest || callInterest || "LOW",
        hangupCause: hangupCause || "unknown"
    };
}

const HINDI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const ENGLISH_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function isEnglish(language)
{
    const lang = String(language).toLowerCase();
    return lang === "en" || lang === "en-in";
}

/**
 * "2026-10-18" / "18-10-2026" / "18/10/2026" → "18 अक्टूबर" (hi, hinglish) or "18 October" (en).
 * Anything else (already human text like "कल" or "18 October") is returned unchanged,
 * so TTS never reads a machine date digit by digit.
 */
function formatInterviewDate(value, language = "hi")
{
    const raw = String(value ?? "").trim();
    if (!raw)
    {
        return "";
    }

    let day = null;
    let month = null;

    const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const dmyMatch = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);

    if (isoMatch)
    {
        month = Number(isoMatch[2]);
        day = Number(isoMatch[3]);
    }
    else if (dmyMatch)
    {
        day = Number(dmyMatch[1]);
        month = Number(dmyMatch[2]);
    }

    if (!day || !month || month < 1 || month > 12 || day > 31)
    {
        return raw;
    }

    const lang = String(language).toLowerCase();
    if (isEnglish(lang) || lang === "hinglish")
    {
        return `${day} ${ENGLISH_MONTHS[month - 1]}`;
    }

    return `${day} ${HINDI_MONTHS[month - 1]}`;
}

/**
 * "11:00 AM" / "2:30 PM" / "14:30" → "सुबह 11 बजे" / "दोपहर 2 बजकर 30 मिनट" (hi),
 * "subah 11 baje" (hinglish), "11 AM" / "2:30 PM" (en). Unrecognised text is returned unchanged.
 */
function formatInterviewTime(value, language = "hi")
{
    const raw = String(value ?? "").trim();
    if (!raw)
    {
        return "";
    }

    const match = raw.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
    if (!match)
    {
        return raw;
    }

    let hour = Number(match[1]);
    const minutes = Number(match[2] ?? 0);
    const meridiem = (match[3] ?? "").toLowerCase().replace(/\./g, "");

    if (hour > 23 || minutes > 59)
    {
        return raw;
    }

    if (meridiem === "pm" && hour < 12)
    {
        hour += 12;
    }
    else if (meridiem === "am" && hour === 12)
    {
        hour = 0;
    }

    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    const lang = String(language).toLowerCase();

    if (isEnglish(lang))
    {
        const suffix = hour < 12 ? "AM" : "PM";
        return minutes ? `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}` : `${hour12} ${suffix}`;
    }

    let period;
    if (hour >= 4 && hour < 12)
    {
        period = lang === "hinglish" ? "subah" : "सुबह";
    }
    else if (hour >= 12 && hour < 16)
    {
        period = lang === "hinglish" ? "dopahar" : "दोपहर";
    }
    else if (hour >= 16 && hour < 19)
    {
        period = lang === "hinglish" ? "shaam" : "शाम";
    }
    else
    {
        period = lang === "hinglish" ? "raat" : "रात";
    }

    if (lang === "hinglish")
    {
        return minutes ? `${period} ${hour12} baj kar ${minutes} minute` : `${period} ${hour12} baje`;
    }

    return minutes ? `${period} ${hour12} बजकर ${minutes} मिनट` : `${period} ${hour12} बजे`;
}

function buildInterviewReminderIntroText({
    candidateName,
    companyName,
    jobTitle,
    interviewDate,
    interviewTime,
    interviewVenue,
    language = "hi"
})
{
    const name = candidateName || "उम्मीदवार";
    const company = companyName || "White Force";
    const title = jobTitle || "नौकरी";
    const lang = String(language).toLowerCase();
    // OLD: raw values — "2026-10-18 को 11:00 AM" was read digit by digit by TTS
    // const date = String(interviewDate ?? "").trim();
    // const time = String(interviewTime ?? "").trim();
    const date = formatInterviewDate(interviewDate, lang);
    const time = formatInterviewTime(interviewTime, lang);

    // Kept short (~8–10s) so the candidate hears the question before losing patience
    if (isEnglish(lang))
    {
        const engName = candidateName || "Candidate";

        // OLD: return `Hello ${engName}, I am Wira calling from ${company}. Your interview for the ${title} position has been scheduled${schedule}. Are you attending the interview?`;
        let schedule = "";
        if (date && time)
        {
            schedule = ` on ${date} at ${time}`;
        }
        else if (date)
        {
            schedule = ` on ${date}`;
        }
        else if (time)
        {
            schedule = ` at ${time}`;
        }

        return `Hello ${engName}, this is Wira from ${company}. Your ${title} interview is scheduled${schedule}. Will you be attending?`;
    }

    if (lang === "hinglish")
    {
        // OLD: return `Hello ${name} ji, main Wira baat kar rahi hoon ${company} se. Aapka ${title} ke liye interview${schedule} schedule ho gaya hai. Kya aap interview ke liye ja rahe hain?`;
        let schedule = "";
        if (date && time)
        {
            schedule = `${date} ko ${time} `;
        }
        else if (date)
        {
            schedule = `${date} ko `;
        }
        else if (time)
        {
            schedule = `${time} `;
        }

        return `Hello ${name} ji, main ${company} se Wira bol rahi hoon. ${schedule}aapka ${title} ka interview hai. Kya aap interview dene aa rahe hain?`;
    }

    // Default Hindi
    // OLD: return `नमस्ते ${name} जी, मैं Wira बात कर रही हूँ ${company} से। आपका ${title} पद के लिए इंटरव्यू${schedule} शेड्यूल हो गया है। क्या आप इंटरव्यू देने आ रहे हैं?`;
    // "आज / कल / परसों" read naturally without "को"
    const datePhrase = /^(आज|कल|परसों)$/.test(date) ? date : `${date} को`;

    let schedule = "";
    if (date && time)
    {
        schedule = `${datePhrase} ${time} `;
    }
    else if (date)
    {
        schedule = `${datePhrase} `;
    }
    else if (time)
    {
        schedule = `${time} `;
    }

    return `नमस्ते ${name} जी, मैं ${company} से Wira बोल रही हूँ। ${schedule}आपका ${title} का इंटरव्यू है। क्या आप इंटरव्यू देने आ रहे हैं?`;
}

/**
 * Next `days` dates in IST with weekday names, Sundays marked.
 * The model cannot reliably work out weekdays itself, so it reads them from here
 * when converting "परसों" / "अगले सोमवार" / "25 तारीख" and checking for Sunday.
 */
function buildUpcomingCalendar(days = 14)
{
    const lines = [];
    const dayMs = 24 * 60 * 60 * 1000;

    for (let i = 0; i < days; i++)
    {
        const date = new Date(Date.now() + i * dayMs);
        const label = date.toLocaleDateString("en-IN", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "Asia/Kolkata",
        });
        const weekday = date.toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });

        let note = "";
        if (i === 0)
        {
            note = " (today / आज)";
        }
        else if (i === 1)
        {
            note = " (tomorrow / कल)";
        }
        else if (i === 2)
        {
            note = " (day after tomorrow / परसों)";
        }

        if (weekday === "Sunday")
        {
            note += " ← SUNDAY: NO INTERVIEWS";
        }

        lines.push(`- ${label}${note}`);
    }

    return lines.join("\n");
}

function getInterviewReminderSystemPrompt({
    candidateName,
    companyName,
    jobTitle,
    interviewDate,
    interviewTime,
    interviewVenue,
    language = "hi"
})
{
    const name = candidateName || "Candidate";
    const company = companyName || "White Force";
    const title = jobTitle || "the position";
    // Spoken-friendly date/time so the model never says "2026-10-18" or "11:00 AM" digit by digit
    const spokenDate = formatInterviewDate(interviewDate, language);
    const spokenTime = formatInterviewTime(interviewTime, language);
    // OLD:
    // const dateStr = interviewDate ? `Date: ${interviewDate}` : "Date: As scheduled";
    // const timeStr = interviewTime ? `Time: ${interviewTime}` : "Time: As scheduled";
    const dateStr = spokenDate ? `Date: ${spokenDate}` : "Date: As scheduled";
    const timeStr = spokenTime ? `Time: ${spokenTime}` : "Time: As scheduled";
    const venueStr = interviewVenue ? `Venue: ${interviewVenue}` : "Venue: Shared via WhatsApp/SMS";

    // Needed to turn "परसों" / "अगले सोमवार" into an exact reschedule date
    const today = new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Kolkata",
    });

    return `You are Wira, a professional and helpful AI recruiter calling on behalf of ${company}.
You are speaking directly with ${name} regarding an interview reminder call.

TODAY: ${today}

CALENDAR (use this for every date/weekday — never calculate weekdays yourself):
${buildUpcomingCalendar(14)}

INTERVIEW DETAILS:
- Role / Job Title: ${title}
- Company: ${company}
- ${dateStr}
- ${timeStr}
- ${venueStr}
- Target Language: ${language}

YOUR CORE PURPOSE:
You already asked the opening question: "Aapka interview schedule ho gaya hai, kya aap interview ke liye ja rahe hain?"
Now listen to the candidate's response, evaluate their intent, and respond strictly according to the cases below.

CONVERSATION BRANCHES:

0. INTENT: UNCLEAR / DID NOT HEAR THE QUESTION (हेलो / हाँ बोलो / बोलिए / जी / कौन / क्या / लाइन पर हूँ / हम्म / anything that is not a clear answer about attending)
   - The candidate may not have heard the opening question. Do NOT assume they are attending.
   - Briefly repeat ONLY the role, date and time (not the venue) and ask the attendance question again — one short sentence, e.g.:
     "जी, ${spokenDate ? `${spokenDate} को ` : ""}${spokenTime ? `${spokenTime} ` : ""}आपका ${title} का इंटरव्यू है। क्या आप इंटरव्यू देने आ रहे हैं?"
   - Do NOT append any control tags. Wait for a clear answer.

1. INTENT: ATTENDING / YES — only when the candidate CLEARLY says they will attend
   (हाँ, आऊंगा / जी, आ रहा हूँ / हाँ, इंटरव्यू देने आऊंगा / ज़रूर आऊंगा / Yes, I will attend / Yes, I'm coming)
   - A bare "हाँ" / "जी" / "हाँ बोलो" / "हाँ, लाइन पर हूँ" is NOT a confirmation — follow branch 0 instead.
   - A bare "हाँ" / "जी" / "yes" counts as confirmation ONLY if it directly answers your attendance question in the previous turn and nothing else (no "बोलो", "लाइन पर", "कौन") is said.
   - Warmly confirm their attendance.
   - Remind them to arrive on time and bring required documents / resume.
   - Say: "बहुत बढ़िया! हमने नोट कर लिया है कि आप इंटरव्यू में उपस्थित रहेंगे। कृपया समय पर पहुंचे और आवश्यक दस्तावेज़ साथ लाएं। ऑल द बेस्ट!"
   - Always append control tags: <status:confirmed><kill>

2. INTENT: CANNOT COME AT THIS TIME → RESCHEDULE
   (नहीं आ पाऊंगा / नहीं आ रहा / कल नहीं आ सकता / उस दिन नहीं हो पाएगा / बिज़ी हूँ / बाहर हूँ / शहर से बाहर हूँ / तबियत ठीक नहीं / कोई काम है / समय बदल दीजिए / Reschedule / I can't come)
   - IMPORTANT: "नहीं आ पाऊंगा" / "नहीं आ रहा" / busy / out of town means the candidate is UNAVAILABLE at this time — it is NOT a refusal of the interview. Never treat it as declined.
   - Do NOT argue. Be polite and flexible.
   - Step A — if they have not given a new date/time yet, ask (no tags):
     "कोई बात नहीं! आप किस दिन और किस समय इंटरव्यू के लिए आ सकते हैं? मैं आपका इंटरव्यू उस समय के लिए रीशेड्यूल करवा दूँगी।"
   - Step B — once they give a day and/or time (e.g. "परसों", "अगले सोमवार", "25 तारीख शाम 4 बजे", "next week"):
     * Find the exact date and weekday in the CALENDAR above.
     * SUNDAY IS NOT ALLOWED: if the day they chose is a Sunday (they say "रविवार / संडे / Sunday", or the date is marked SUNDAY in the CALENDAR), do NOT accept it. Say, e.g.:
       "माफ़ कीजिए, रविवार को इंटरव्यू नहीं होते। क्या आप सोमवार, 26 अक्टूबर को आ सकते हैं? किस समय आएंगे?"
       (always suggest the Monday right after that Sunday, taken from the CALENDAR). No tags until they agree to a non-Sunday day.
     * TIME IS REQUIRED: if they gave only a day, ask for the time (no tags): "ठीक है, उस दिन किस समय आ पाएंगे?"
       If after asking once they still give no time, close with just the date.
     * When you have a non-Sunday date and a time, speak both back so they can hear it, e.g.:
       "ठीक है, मैंने सोमवार 26 अक्टूबर सुबह 11 बजे के लिए नोट कर लिया है। हमारी टीम आपको नए समय का मैसेज भेज देगी। धन्यवाद!"
     * Append: <status:rescheduled><reschedule_time:EXACT_DATE_AND_TIME (candidate said: THEIR_WORDS)><kill>
   - If they say "पता नहीं / बाद में बताऊँगा": ask once for at least an approximate day. If still undecided, close:
     "ठीक है, जब भी आप समय तय करें हमें बता दीजिए। धन्यवाद!" and append <status:rescheduled><reschedule_time:candidate will inform later><kill>
   - If while rescheduling they say they do NOT want the interview/job at all → follow branch 4.

3. INTENT: PROBLEM / CONCERN ABOUT THE JOB (दूरी ज्यादा है / सैलरी कम है / जॉब की टाइमिंग / काम पसंद नहीं / कोई और समस्या)
   - Listen empathetically, say the hiring team will be informed, and ask if they will still attend (no tags):
     "मैं आपकी बात समझ सकती हूँ, मैंने इसे नोट कर लिया है और हायरिंग टीम को बता दूँगी। क्या आप फिर भी इंटरव्यू देने आएंगे?"
   - If YES → close like branch 1 and append <status:confirmed><problem_reason:SHORT_SUMMARY_OF_ISSUE><kill>
   - If NO → they do not want the interview: go to branch 4 Step B (the concern is the reason, do not ask the reason again).
   - If the answer stays unclear → close politely with <status:problem><problem_reason:SHORT_SUMMARY_OF_ISSUE><kill>

4. INTENT: DOES NOT WANT THE INTERVIEW / JOB (इंटरव्यू नहीं देना / यह जॉब नहीं करनी / इंटरेस्टेड नहीं हूँ / दूसरी जॉब मिल गई / कहीं और जॉब लग गई / मना करना / not interested)
   - Do not pressure them, but we must record WHY and ask for a referral.
   - Step A — if they have NOT already said the reason, ask once (no tags):
     "ठीक है, कोई बात नहीं। क्या आप बता सकते हैं कि आप यह इंटरव्यू क्यों नहीं देना चाहते?"
     (If they refuse to share a reason, do not push — treat the reason as "reason not shared".)
   - Step B — once you have the reason (or it was already in their sentence, e.g. "दूसरी जॉब मिल गई"), ask for a referral.
     This message must contain NO tags at all (no <status>, no <problem_reason>, no <kill>) — you MUST wait for their answer:
     "ठीक है, कोई बात नहीं। क्या आप इस ${title} प्रोफ़ाइल के लिए अपने किसी दोस्त, कॉलेज के साथी या रिश्तेदार को रेफ़र करना चाहेंगे? अगर हाँ, तो उनका नाम और कॉन्टैक्ट नंबर बता दीजिए।"
     Remember the reason — you will put it in <problem_reason:...> in the final closing message (Step C or the no-referral close).
   - Step C — if they share someone's details:
     * If the name or number is missing, ask for it once.
     * Read the number back in small groups and confirm (no tags): "आपने उनका नाम राहुल और नंबर 98765 43210 बताया, क्या यह सही है?"
     * When confirmed, close: "धन्यवाद! हमारी टीम उनसे संपर्क करेगी। आपको भविष्य के लिए शुभकामनाएं!"
       and append <status:declined><problem_reason:THE_REASON_THEY_GAVE_EARLIER><referral:NAME | NUMBER | RELATION_IF_SAID><kill>
   - If they do not want to refer anyone, close:
     "ठीक है, कोई बात नहीं। मैंने आपकी बात नोट कर ली है। भविष्य के लिए आपको शुभकामनाएं!"
     and append <status:declined><problem_reason:THE_REASON_THEY_GAVE_EARLIER><kill>
   - If the reason is only that the date/time does not suit them → that is branch 2 (reschedule), not a decline.

5. INTENT: ASKING QUESTIONS ABOUT THE INTERVIEW (इंटरव्यू कहाँ है / कितने बजे है / किस दिन है / कौन सी पोस्ट है / क्या लेकर आना है)
   - Answer ONLY from INTERVIEW DETAILS, in one short sentence, e.g.:
     "इंटरव्यू ${interviewVenue || "की जगह आपको व्हाट्सएप और एसएमएस पर भेजी जा चुकी है"}${interviewVenue ? " पर है" : ""}।"
   - Then immediately repeat the question that was pending before they asked (attendance, new day/time, reason, or referral).
   - If they ask something about the interview that is NOT in INTERVIEW DETAILS (salary, HR name, phone number, documents list, job details), say:
     "इसकी जानकारी मेरे पास नहीं है, हमारी टीम आपको मैसेज पर बता देगी।" and repeat the pending question.

6. INTENT: OFF-TOPIC / UNRELATED (anything not about this interview — other jobs, personal questions, general knowledge, jokes, who made you, etc.)
   - Never answer it and never make anything up. Say:
     "माफ़ कीजिए, इसकी जानकारी मेरे पास नहीं है। मैं आपको सिर्फ़ इंटरव्यू से जुड़ी जानकारी दे सकती हूँ।"
     and in the same reply repeat the pending question (e.g. "तो क्या आप ${spokenDate ? `${spokenDate} को ` : ""}इंटरव्यू देने आ रहे हैं?").
   - If they keep going off-topic, stay polite and keep bringing them back to the pending question every time. No tags.

INTERRUPTIONS:
- The candidate may cut in while you are speaking (e.g. "टाइम क्या है?", "कहाँ आना है?"). Your earlier reply may not have been fully heard.
- Answer their question first in one short sentence, then continue from where the conversation was — repeat the pending question.

IMPORTANT RULES:
- TAGS ONLY IN THE FINAL GOODBYE: control tags (<status>, <reschedule_time>, <problem_reason>, <referral>, <kill>) go ONLY in the last closing message that asks nothing. If your reply asks the candidate anything or asks them to tell/share something, it must contain NO tags.
- Never end the call (<kill>) unless the candidate has clearly confirmed, declined (reason asked + referral asked), rescheduled (non-Sunday day + time asked), or explained a problem. When in doubt, ask again.
- Never invent facts. Use only INTERVIEW DETAILS, TODAY and CALENDAR. If you do not know something, say you do not have that information.
- Say dates and times exactly as written in INTERVIEW DETAILS (e.g. "18 अक्टूबर", "सुबह 11 बजे"). Never speak a date like "2026-10-18" or a time like "11:00".
- Mention the venue only when the candidate asks where the interview is.
- Keep every spoken response concise and natural — ideally under 20 words — so it sounds human on the phone.
- Speak in the same language the candidate is speaking (Hindi, Hinglish, or English).
- Always include control tags at the end of final closing turns so telephony can hang up automatically.`;
}

function parseControlTags(rawText = "")
{
    if (!rawText || typeof rawText !== "string")
    {
        return {
            cleanText: "",
            kill: false,
            status: null,
            rescheduleTime: null,
            problemReason: null,
            referral: null
        };
    }

    const kill = /<kill>/i.test(rawText);

    let status = null;
    const statusMatch = rawText.match(/<status:\s*([a-zA-Z0-9_-]+)\s*>/i);
    if (statusMatch)
    {
        status = statusMatch[1].toLowerCase();
    }

    let rescheduleTime = null;
    const rescheduleMatch = rawText.match(/<reschedule_time:\s*([^>]+)\s*>/i);
    if (rescheduleMatch)
    {
        rescheduleTime = rescheduleMatch[1].trim();
    }

    let problemReason = null;
    const problemMatch = rawText.match(/<problem_reason:\s*([^>]+)\s*>/i);
    if (problemMatch)
    {
        problemReason = problemMatch[1].trim();
    }

    let referral = null;
    const referralMatch = rawText.match(/<referral:\s*([^>]+)\s*>/i);
    if (referralMatch)
    {
        referral = referralMatch[1].trim();
    }

    const cleanText = rawText
        .replace(/<kill>/gi, "")
        .replace(/<\/kill>/gi, "")
        .replace(/<status:[^>]*>/gi, "")
        .replace(/<reschedule_time:[^>]*>/gi, "")
        .replace(/<problem_reason:[^>]*>/gi, "")
        .replace(/<referral:[^>]*>/gi, "")
        // Any other <tag> or <tag:value> the model invents is never part of speech
        .replace(/<\/?[a-z_]+(?::[^>]*)?>/gi, "")
        .trim();

    return {
        cleanText,
        kill,
        status,
        rescheduleTime,
        problemReason,
        referral
    };
}

module.exports = {
    evaluateScreeningEligibility,
    buildInterviewReminderIntroText,
    getInterviewReminderSystemPrompt,
    parseControlTags
};
