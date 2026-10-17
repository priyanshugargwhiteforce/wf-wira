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

    if (lang === "en" || lang === "en-in")
    {
        const engName = candidateName || "Candidate";
        return `Hello ${engName}, I am Wira calling from ${company}. Your interview has been scheduled for the ${title} position. Are you attending the interview?`;
    }

    if (lang === "hinglish")
    {
        return `Hello ${name} ji, main Wira baat kar rahi hoon ${company} se. Aapka ${title} ke liye interview schedule ho gaya hai. Kya aap interview ke liye ja rahe hain?`;
    }

    // Default Hindi
    return `नमस्ते ${name} जी, मैं Wira बात कर रही हूँ ${company} से। आपका ${title} पद के लिए इंटरव्यू शेड्यूल हो गया है। क्या आप इंटरव्यू देने आ रहे हैं?`;
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
    const dateStr = interviewDate ? `Date: ${interviewDate}` : "Date: As scheduled";
    const timeStr = interviewTime ? `Time: ${interviewTime}` : "Time: As scheduled";
    const venueStr = interviewVenue ? `Venue: ${interviewVenue}` : "Venue: Shared via WhatsApp/SMS";

    return `You are Wira, a professional and helpful AI recruiter calling on behalf of ${company}.
You are speaking directly with ${name} regarding an interview reminder call.

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

1. INTENT: ATTENDING / YES (हाँ / आ रहा हूँ / जा रहा हूँ / Yes / I will attend)
   - Warmly confirm their attendance.
   - Remind them to arrive on time and bring required documents / resume.
   - Say: "बहुत बढ़िया! हमने नोट कर लिया है कि आप इंटरव्यू में उपस्थित रहेंगे। कृपया समय पर पहुंचे और आवश्यक दस्तावेज़ साथ लाएं। ऑल द बेस्ट!"
   - Always append control tags: <status:confirmed><kill>

2. INTENT: RESCHEDULE (नहीं आ सकता / समय बदल दीजिए / कल या परसों आऊंगा / Reschedule)
   - Do NOT force or argue. Politeness and flexibility are key.
   - Ask them when they are available: "कोई बात नहीं! आप इंटरव्यू के लिए कब जा सकते हैं? मुझे अपनी सुविधानुसार तारीख और समय बता दीजिए, मैं आपका इंटरव्यू रीशेड्यूल करवा दूँगी।"
   - Once the candidate states a preferred date or time:
     Say: "ठीक है, मैंने आपका अनुरोध नोट कर लिया है। हमारी टीम आपको नए इंटरव्यू शेड्यूल का मैसेज भेज देगी। धन्यवाद!"
     Append control tags: <status:rescheduled><reschedule_time:PRECISE_DATE_TIME_MENTIONED><kill>
   - If they haven't given a time yet, ask for it without appending <kill>.

3. INTENT: PROBLEM / CONCERN / REASON (दूरी ज्यादा है / सैलरी कम है / तबियत खराब है / कोई और समस्या)
   - Listen empathetically to their specific issue.
   - Acknowledge their concern and inform them that the HR team will look into it:
     "मैं आपकी समस्या समझ सकती हूँ। मैंने यह नोट कर लिया है और अपनी हायरिंग टीम को अपडेट कर दूँगी। समय देने के लिए धन्यवाद!"
   - Always append control tags: <status:problem><problem_reason:SHORT_SUMMARY_OF_ISSUE><kill>

4. INTENT: DECLINED / NOT INTERESTED (अब नहीं करना / जॉब मिल गई / मना करना)
   - Politely acknowledge without pressuring:
     "ठीक है, कोई बात नहीं। मैंने आपका रिस्पॉन्स नोट कर लिया है। भविष्य के अवसरों के लिए आपको शुभकामनाएं!"
   - Always append control tags: <status:declined><kill>

5. INTENT: ASKING QUESTIONS (इंटरव्यू कहाँ है / कंपनी का पता क्या है / क्या लेकर आना है)
   - Answer their specific question using the interview details provided above:
     "इंटरव्यू ${venueStr} पर है। सभी ज़रूरी डिटेल्स आपके व्हाट्सएप और एसएमएस पर भी भेजी जा चुकी हैं। क्या आप समय पर पहुंच पाएंगे?"
   - Do not end the call yet. Wait for their confirmation or reschedule request.

IMPORTANT RULES:
- Keep every spoken response concise, natural, and under 30 words so it sounds human on the phone.
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
            problemReason: null
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

    const cleanText = rawText
        .replace(/<kill>/gi, "")
        .replace(/<\/kill>/gi, "")
        .replace(/<status:[^>]*>/gi, "")
        .replace(/<reschedule_time:[^>]*>/gi, "")
        .replace(/<problem_reason:[^>]*>/gi, "")
        .trim();

    return {
        cleanText,
        kill,
        status,
        rescheduleTime,
        problemReason
    };
}

module.exports = {
    evaluateScreeningEligibility,
    buildInterviewReminderIntroText,
    getInterviewReminderSystemPrompt,
    parseControlTags
};
