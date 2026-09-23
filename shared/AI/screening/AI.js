const prompter = require("./prompts");
const AI = require("@wira/shared/AI/executeAI");

const USD_TO_INR_FALLBACK = 94.50;
const GEMINI_USD_RATES =
{
    inputPerToken: 0.10 / 1_000_000,
    cachedInputPerToken: 0.01 / 1_000_000,
    outputPerToken: 0.40 / 1_000_000
};

function cleanJsonResponse(text)
{
    if(!text || typeof text !== "string")
    {
        return "";
    }

    let clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    const objectStart = clean.indexOf("{");
    const arrayStart = clean.indexOf("[");

    if(objectStart === -1 && arrayStart === -1)
    {
        return clean;
    }

    const isArray = arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart);
    const start = isArray ? arrayStart : objectStart;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for(let i = start; i < clean.length; i++)
    {
        const ch = clean[i];

        if(escaped)
        {
            escaped = false;
            continue;
        }

        if(ch === "\\") 
        { 
            escaped = true; 
            continue; 
        }

        if(ch === '"')
        {
            inString = !inString;
            continue;
        }

        if(inString)
        {
            continue;
        }

        if(ch === "{" || ch === "[")
        {
            depth++;
        }

        if(ch === "}" || ch === "]")
        {
            depth--;
        }

        if(depth === 0)
        {
            end = i;
            break;
        }
    }

    if(end !== -1)
    {
        return clean.slice(start, end + 1);
    }

    clean = clean.slice(start);
    clean = clean.trimEnd().replace(/,\s*"[^"]*"\s*:\s*[^,}\]]*$/, "").replace(/,\s*\{[^}]*$/, "").replace(/,\s*"[^"]*"$/, "").replace(/,\s*$/, "");

    let inStr = false;
    let esc = false;

    for(const ch of clean)
    {
        if(esc)        
        { 
            esc = false; 
            continue; 
        }

        if(ch === "\\") 
        { 
            esc = true;  
            continue; 
        }

        if(ch === '"')  
        { 
            inStr = !inStr; 
        }
    }

    if(inStr)
    {
        clean += '"';
    }

    const stack = [];
    inStr = false;
    esc = false;

    for(const ch of clean)
    {
        if(esc)        
        { 
            esc = false; 
            continue; 
        }

        if(ch === "\\") 
        { 
            esc = true;  
            continue; 
        }

        if(ch === '"')
        { 
            inStr = !inStr; 
            continue; 
        }

        if(inStr)
        { 
            continue; 
        }

        if(ch === "{")
        {
            stack.push("}");
        }

        if(ch === "[")
        {
            stack.push("]");
        }

        if(ch === "}" || ch === "]")
        {
            stack.pop();
        }
    }

    clean += stack.reverse().join("");
    return clean;
}

async function replyChatTest({jobSummary, questions, strikes, reAsk, allowInput, messages, modelName = "gpt-oss", streaming = false}) 
{
    const promptMessages = prompter.getPromptForReplyChat(
      jobSummary,
      questions,
      strikes,
      reAsk,
      allowInput,
      messages
    );

    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.run({
              messages: promptMessages,
              modelName,
              streaming
            });

            const clean = cleanJsonResponse(response);
            return JSON.parse(clean);
        }
        catch (error)
        {
            retries++;
            if (retries >= maxRetries)
            {
                return {
                    role: "assistant",
                    content: "I understand. Please continue.",
                    options: [],
                    links: [],
                    allowInput: true
                };
            }
        }
    }
}  

async function abuseDetectionTest({ text, modelName = "gpt-oss", streaming = false })
{
  const promptMessages = prompter.getPromptForAbuseDetection(text);
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries)
  {
      try
      {
          const response = await AI.run({
            messages: promptMessages,
            modelName,
            streaming
          });

          const clean = cleanJsonResponse(response);
          return JSON.parse(clean);
      }
      catch (error)
      {
          retries++;
          if (retries >= maxRetries)
          {
              return {
                  isAbusive: false
              };
          }
      }
  }
}

async function relevanceDetectionTest({ messages, modelName = "gpt-oss", streaming = false })
{
  const promptMessages = prompter.getPromptForRelevanceDetection(messages);
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries)
  {
      try
      {
          const response = await AI.run({
            messages: promptMessages,
            modelName,
            streaming
          });

          const clean = cleanJsonResponse(response);
          return JSON.parse(clean);
      }
      catch (error)
      {
          retries++;
          if (retries >= maxRetries)
          {
              return {
                  isRelevant: true
              };
          }
      }
  }
}

async function answerExtractionTest({ question, options, text, modelName = "gpt-oss", streaming = false })
{
  const promptMessages = prompter.getPromptForAnswerExtraction(
    question,
    options,
    text
  );

  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries)
  {
      try
      {
          const response = await AI.run({
            messages: promptMessages,
            modelName,
            streaming
          });

          const clean = cleanJsonResponse(response);
          return JSON.parse(clean);
      }
      catch (error)
      {
          retries++;
          if (retries >= maxRetries)
          {
              return {
                  extractedAnswer: null,
                  confidence: "low"
              };
          }
      }
  }
}

async function clarificationDetectionTest({ messages, modelName = "gpt-oss", streaming = false })
{
  const promptMessages = prompter.getPromptForClarificationDetection(messages);
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries)
  {
      try
      {
          const response = await AI.run({
            messages: promptMessages,
            modelName,
            streaming
          });

          const clean = cleanJsonResponse(response);
          return JSON.parse(clean);
      }
      catch (error)
      {
          retries++;
          if (retries >= maxRetries)
          {
              return {
                  needsClarification: false
              };
          }
      }
  }
}

async function clarificationQuestionTest({ messages, modelName = "gpt-oss", streaming = false })
{
  const promptMessages = prompter.getPromptForClarificationQuestion(messages);
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries)
  {
      try
      {
          const response = await AI.run({
            messages: promptMessages,
            modelName,
            streaming
          });

          return response;
      }
      catch (error)
      {
          retries++;
          if (retries >= maxRetries)
          {
              return "Could you please clarify your response?";
          }
      }
  }
}

async function forcedOptionSelectionTest({ question, options, responses, modelName = "gpt-oss", streaming = false })
{
  const promptMessages = prompter.getPromptForForcedOptionSelection(
    question,
    options,
    responses
  );

  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries)
  {
      try
      {
          const response = await AI.run({
            messages: promptMessages,
            modelName,
            streaming
          });

          const clean = cleanJsonResponse(response);
          const parsed = JSON.parse(clean);
          
          if (options.includes(parsed.selectedOption))
          {
              return parsed;
          }
          
          throw new Error("Invalid option selected");
      }
      catch (error)
      {
          retries++;
          if (retries >= maxRetries)
          {
              return {
                  selectedOption: options[0]
              };
          }
      }
  }
}

async function acknowledgementTest({ modelName = "gpt-oss", streaming = false })
{
  const promptMessages = prompter.getPromptForAcknowledgement();
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries)
  {
      try
      {
          const response = await AI.run({
            messages: promptMessages,
            modelName,
            streaming
          });

          return response;
      }
      catch (error)
      {
          retries++;
          if (retries >= maxRetries)
          {
              return "Thank you for your response.";
          }
      }
  }
}

async function terminationMessageTest({ modelName = "gpt-oss", streaming = false })
{
  const promptMessages = prompter.getPromptForTerminationMessage();
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries)
  {
      try
      {
          const response = await AI.run({
            messages: promptMessages,
            modelName,
            streaming
          });

          return response;
      }
      catch (error)
      {
          retries++;
          if (retries >= maxRetries)
          {
              return "We apologize, but we need to end this conversation. Thank you for your time.";
          }
      }
  }
}

async function abuseAndRelevanceDetectionTest({messages, modelName = "gpt-oss", streaming = false})
{
    const promptMessages = prompter.getPromptForAbuseAndRelevanceDetection(messages);
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.run({
              messages: promptMessages,
              modelName,
              streaming
            });

            const clean = cleanJsonResponse(response);
            return JSON.parse(clean);
        }
        catch (error)
        {
            retries++;
            if (retries >= maxRetries)
            {
                return {
                    isAbusive: false,
                    isRelevant: true
                };
            }
        }
    }
}

async function forcedDecision({ question, messages, modelName = "gpt-oss", streaming = false })
{
    const promptMessages = prompter.getPromptForForcedDecision({ question, messages });
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) 
    {
        try 
        {
            const response = await AI.run({
                messages: promptMessages,
                modelName,
                streaming
            });

            const clean = cleanJsonResponse(response);
            const parsed = JSON.parse(clean);

            if (!parsed.selectedOption || typeof parsed.selectedOption !== 'string') 
            {
                throw new Error("Invalid forced decision structure");
            }

            if (!question.options.includes(parsed.selectedOption)) 
            {
                throw new Error("Selected option not in predefined options");
            }

            return parsed;
        } 
        catch (error) 
        {
            retries++;

            if (retries >= maxRetries) 
            {
                const fallbackOption = question.options.find(opt => opt.toLowerCase() === "no") 
                                    || question.options[question.options.length - 1] 
                                    || question.options[0];

                return { selectedOption: fallbackOption };
            }
        }
    }
}

async function initTest(jobData, modelName = "gpt-oss", streaming = false, language = "English")
{
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const messages = prompter.getPromptForAssessmentGeneration(jobData, language);

            const response = await AI.run({
                messages,
                modelName,
                streaming,
                max_tokens: 4096,
            });

            const clean = cleanJsonResponse(response);
            const parsed = JSON.parse(clean);

            const data = Array.isArray(parsed)
                ? parsed
                : (parsed.questions || parsed.data || parsed.test || Object.values(parsed)[0]);

            if (!Array.isArray(data) || data.length === 0)
            {
                throw new Error("Parsed result is not a valid array");
            }

            return data;
        }
        catch (error)
        {
            console.error(`❌ initTest attempt ${retries + 1} failed:`, error.message);
            retries++;
        }
    }

    console.error("❌ initTest failed after all retries");
    return [];
}

async function checkTest(data, modelName = "gpt-oss", streaming = false)
{
    const messages = prompter.getPromptForAssessmentScoring(data);
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.run({
                messages,
                modelName,
                streaming,
            });

            const clean = cleanJsonResponse(response);
            return JSON.parse(clean);
        }
        catch (error)
        {
            retries++;
            if (retries >= maxRetries)
            {
                return {
                    score: 0,
                    totalScore: 0,
                    percentage: 0
                };
            }
        }
    }
}

async function initScreening(jobData, modelName = "gpt-oss", streaming = false, language = "English")
{
    const messages = prompter.getPromptForScreeningInit(jobData, language);
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.run({
                messages,
                systemPrompt: null,
                modelName,
                streaming,
            });

            const clean  = cleanJsonResponse(response);
            const parsed = JSON.parse(clean);

            // Normalize — handle different shapes the model might return
            const normalized = {
                introduction_message : parsed.introduction_message || parsed.introductionMessage || parsed.introduction || "",
                job_summary          : parsed.job_summary          || parsed.jobSummary          || parsed.summary      || "",
                questions            : parsed.questions            || parsed.Questions            || parsed.screening_questions || [],
            };

            // Validate structure before returning
            if (!Array.isArray(normalized.questions) || normalized.questions.length === 0)
            {
                console.error("❌ initScreening: questions array missing or empty. Parsed:", JSON.stringify(parsed, null, 2));
                throw new Error("questions array missing or empty");
            }

            return normalized;
        }
        catch (error)
        {
            console.error(`❌ initScreening attempt ${retries + 1} failed:`, error.message);
            retries++;
        }
    }

    console.error("❌ initScreening failed after all retries");
    return null; // Return null so the route can handle it gracefully
}

async function replyChat({ jobSummary, questions, scope, messages, modelName = "gpt-oss", mode = "normal", streaming = false, language = "English" })
{
    const promptMessages = prompter.getPromptForReplyChat({
        jobSummary,
        questions,
        scope,
        messages,
        mode,
        language,
    });

    const validClassifications = ["answered", "followup", "irrelevant", "abusive", "forced"];
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.run({
                messages: promptMessages,
                modelName,
                streaming
            });

            const clean  = cleanJsonResponse(response);
            const parsed = JSON.parse(clean);

            if (
                !parsed.classification ||
                !validClassifications.includes(parsed.classification) ||
                !parsed.next ||
                typeof parsed.next.content !== "string" ||
                typeof parsed.next.predefined !== "boolean" ||
                typeof parsed.next.questionId !== "number" ||
                !Array.isArray(parsed.next.options)
            )
            {
                throw new Error("Invalid response structure");
            }

            return parsed;
        }
        catch (error)
        {
            retries++;

            if (retries >= maxRetries)
            {
                const currentQuestion = questions.find(q => q.id === scope.lastQId);

                return {
                    classification: "followup",
                    answer: null,
                    next: {
                        content: "I understand. Could you elaborate a little more?",
                        questionId: scope.lastQId,
                        predefined: false,
                        options: currentQuestion?.options || []
                    }
                };
            }
        }
    }
}

async function calculateCandidateFit({ jobSummary, questions, modelName = "gpt-oss", streaming = false, language = "English" })
{
    const promptMessages = prompter.getPromptForCandidateFitScore({
        jobSummary,
        questions,
        language,
    });

    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.run({
                messages: promptMessages,
                modelName,
                streaming
            });

            const clean = cleanJsonResponse(response);
            const parsed = JSON.parse(clean);

            if (
                typeof parsed.fitPercentage !== "number" ||
                parsed.fitPercentage < 0 ||
                parsed.fitPercentage > 100
            )
            {
                throw new Error("Invalid fitPercentage value");
            }

            return {
                fitPercentage: Math.round(parsed.fitPercentage)
            };
        }
        catch (error)
        {
            retries++;

            if (retries >= maxRetries)
            {
                const answeredCount = questions.filter(q => q.answered).length;
                const totalCount = questions.length;

                const fallbackScore = totalCount === 0
                    ? 0
                    : Math.round((answeredCount / totalCount) * 60);

                return {
                    fitPercentage: fallbackScore
                };
            }
        }
    }
}

async function initScreeningMessages(language = "English", modelName = "gpt-oss", streaming = false)
{
    const messageKeys = [
        "notInterestedMessage",
        "userQuitMessage",
        "completedWithTestMessage",
        "completedNoTestMessage",
        "continuationPrompt",
        "continuationResumePrefix",
        "notInterestedOption",
        "continuationOptions",
        "invalidOptionMessage",
    ];

    const messages   = prompter.getPromptForStaticMessages(messageKeys, language);
    const maxRetries = 5;
    let retries      = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.run({
                messages,
                modelName,
                streaming,
            });

            const clean  = cleanJsonResponse(response);
            const parsed = JSON.parse(clean);

            if (
                typeof parsed.notInterestedMessage     !== "string" ||
                typeof parsed.userQuitMessage          !== "string" ||
                typeof parsed.completedWithTestMessage !== "string" ||
                typeof parsed.completedNoTestMessage   !== "string" ||
                typeof parsed.continuationPrompt       !== "string" ||
                typeof parsed.continuationResumePrefix !== "string" ||
                typeof parsed.notInterestedOption      !== "string" ||
                typeof parsed.invalidOptionMessage     !== "string" ||
                !Array.isArray(parsed.continuationOptions)          ||
                parsed.continuationOptions.length !== 2             ||
                parsed.continuationOptions[1] !== parsed.notInterestedOption
            )
            {
                throw new Error("Invalid static messages structure");
            }

            return parsed;
        }
        catch (error)
        {
            retries++;

            if (retries >= maxRetries)
            {
                return {
                    notInterestedMessage     : "Thank you for letting us know. Since you're not interested in this opportunity, we'll close this conversation here. We appreciate your time and wish you the best going forward.",
                    userQuitMessage          : "Thank you for your time. We appreciate you considering this opportunity. Best of luck in your job search!",
                    completedWithTestMessage : "Thank you for completing the screening. You can now elevate your chances of getting this job by taking a short assessment. Would you like to proceed?",
                    completedNoTestMessage   : "Thank you for completing the screening. We will review your information and contact you shortly.",
                    continuationPrompt       : "It seems you're having trouble answering. Do you want to continue with the screening?",
                    continuationResumePrefix : "Great! Let's continue. ",
                    notInterestedOption      : "No",
                    continuationOptions      : ["Yes", "No"],
                    invalidOptionMessage     : "Please select one of the options:",
                };
            }
        }
    }
}

async function translateJsonToLanguage({ jsonData, targetLanguage = "English", modelName = "gpt-oss", streaming = false })
{
    const promptMessages = prompter.getPromptForJsonTranslator(targetLanguage);
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.run({
                messages: [
                    ...promptMessages,
                    { role: "user", content: JSON.stringify(jsonData) }
                ],
                modelName,
                streaming,
            });

            const clean = cleanJsonResponse(response);
            const parsed = JSON.parse(clean);

            // Validate that the structure matches the input
            if (typeof parsed !== "object" || parsed === null)
            {
                throw new Error("Translated result is not a valid object");
            }

            return parsed;
        }
        catch (error)
        {
            console.error(`❌ translateJsonToLanguage attempt ${retries + 1} failed:`, error.message);
            retries++;

            if (retries >= maxRetries)
            {
                console.error("❌ translateJsonToLanguage failed after all retries");
                return jsonData; // Return original data as fallback
            }
        }
    }
}

async function isUserDoneSpeaking({ userUtterance, lastAssistantQuestion, modelName = "openai/gpt-oss-20b" })
{
    if (!userUtterance || userUtterance.trim().length === 0) 
    {
        return "-1";
    }

    // Now uses the two clean strings passed straight from the route
    const promptMessages = prompter.checkUserDone(userUtterance, lastAssistantQuestion);
    const maxRetries = 2;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.run({
                messages: promptMessages,
                modelName,
                streaming: false,
                temperature: 0.0,
                max_tokens: 3
            });

            if (!response || typeof response !== "string" || response.trim().length === 0)
            {
                throw new Error("Empty response");
            }

            const cleanedResponse = response.trim();

            if (cleanedResponse.includes("1") && !cleanedResponse.includes("-1")) 
            {
                return "1";
            }
            
            if (cleanedResponse.includes("-1")) 
            {
                return "-1";
            }

            throw new Error(`Unexpected non-numeric response: ${response}`);
        }
        catch (error)
        {
            retries++;

            if (retries >= maxRetries)
            {
                console.error("⚠️ Error checking user state, defaulting to 1:", error.message);
                return "1";
            }
        }
    }
}

async function analyzeConversation(conversation, jobDescription = null)
{
    const maxRetries = 5;
    let retries = 0;

    const assistantTurnCount = conversation.filter(m => m.role === "assistant").length;
    const userTurnCount = conversation.filter(m => m.role === "user").length;

    while(retries < maxRetries)
    {
        try
        {
            const messages = prompter.getPromptForConversationAnalysis(
                conversation,
                jobDescription,
                assistantTurnCount,
                userTurnCount
            );
            const systemContent = messages.find(m => m.role === "system")?.content ?? "";
            const userContent = messages.find(m => m.role === "user")?.content ?? "";

            const { text, usage, costInr } = await AI.runGeminiAnalysis({
                systemPrompt: systemContent,
                userMessage: userContent,
                modelName: "gemini-3.1-flash-lite",
                temperature: 0.0,
                expiryMinutes: 2
            });

            let clean = text ?? "";
            const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);

            if(fenceMatch)
            {
                clean = fenceMatch[1].trim();
            }
            else
            {
                const braceStart = clean.indexOf("{");
                const braceEnd = clean.lastIndexOf("}");

                if(braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart)
                {
                    clean = clean.slice(braceStart, braceEnd + 1);
                }
            }

            let parsed;

            try
            {
                parsed = JSON.parse(clean);
            }
            catch(parseError)
            {
                console.error("❌ analyzeConversation: JSON parse failed.");
                console.error("❌ Raw model output (first 2000 chars):", text?.slice(0, 2000));
                throw new Error("JSON parse failed");
            }

            const normalized =
            {
                cleanTranscript : parsed.cleanTranscript || parsed.conversation_english || parsed.conversation || [],
                qna             : parsed.qna || parsed.screening_qa || parsed.qa || [],
                interest        : parsed.interest || "LOW",
                hangupCause     : parsed.hangupCause || "unknown",
                score           : typeof parsed.score === "number" ? parsed.score : 0,
                scoreReason     : parsed.scoreReason || "",
                summary         : parsed.summary || "",
                geminiPostCost  : costInr,
                jobInterest     : parsed.jobInterest || "LOW",
            };

            if(!Array.isArray(normalized.cleanTranscript) || normalized.cleanTranscript.length === 0)
            {
                console.error("❌ analyzeConversation: cleanTranscript missing or empty.");
                console.error("❌ Parsed keys:", Object.keys(parsed));
                console.error("❌ Raw model output (first 2000 chars):", text?.slice(0, 2000));
                throw new Error("cleanTranscript missing or empty");
            }

            const validInterests = ["LOW", "MEDIUM", "HIGH"];
            const validHangupCauses = [
                "conversation_completed",
                "candidate_ended_call",
                "candidate_busy",
                "requested_callback",
                "candidate_not_interested",
                "candidate_already_placed",
                "call_dropped",
                "language_barrier",
                "no_response",
                "system_ended_call",
                "unknown"
            ];

            if(!validInterests.includes(normalized.interest))
            {
                normalized.interest = "LOW";
            }

            if(!validInterests.includes(normalized.jobInterest))
            {
                normalized.jobInterest = "LOW";
            }

            if(!validHangupCauses.includes(normalized.hangupCause))
            {
                normalized.hangupCause = "unknown";
            }

            if(normalized.score < 0 || normalized.score > 100)
            {
                normalized.score = 0;
            }

            return normalized;
        }
        catch(error)
        {
            console.error(`❌ analyzeConversation attempt ${retries + 1} failed:`, error.message);
            retries++;
        }
    }

    console.error("❌ analyzeConversation failed after all retries");
    return null;
}

async function screeningCall({ candidateName, jobTitle, companyName, jobDescription, messages, language = "hindi-start", screeningQuestions, modelName = "llama-3.3-70b-versatile", onChunk = null })
{
    const promptMessages = prompter.getPromptForScreeningCall({
        candidateName,
        jobTitle,
        companyName,
        jobDescription,
        messages,
        language,
        screeningQuestions
    });

    const maxRetries = 3;
    let retries      = 0;

    while (retries < maxRetries)
    {
        try
        {
            /* COMMENTED OUT FOR GROQ RATE-LIMIT TESTING
            const response = await AI.run({
                messages:  promptMessages,
                modelName,
                streaming: false,
                apiKey: process.env.GROQ_SHAINKI
            });
            */

            /* COMMENTED OUT FOR OLLAMA LATENCY TESTING
            const response = await AI.runNoGroq({
                messages: promptMessages,
                modelName: "gpt-oss",
                streaming: false,
                temperature: 0.0
            });
            */

            const response = await AI.runGemini2({
                messages: promptMessages,
                modelName: "gemini-2.5-flash-lite",
                streaming: false,
                temperature: 0.0,
                apiKey: process.env.GEMINI_KEY
            });

            if (!response || typeof response !== "string" || response.trim().length === 0)
            {
                throw new Error("Empty response from Gemini");
            }

            if (onChunk)
            {
                const words = response.split(" ");

                for (let i = 0; i < words.length; i++)
                {
                    onChunk(i < words.length - 1 ? words[i] + " " : words[i]);
                }
            }

            return response;
        }
        catch (error)
        {
            console.error(`⚠️ screeningCall() Gemini execution failure [${retries + 1}/${maxRetries}]:`, error.message);
            retries++;

            if (retries >= maxRetries)
            {
                return "I'm sorry, could you repeat that?";
            }
        }
    }
}

async function screeningCall2({ candidateName, jobTitle, companyName, jobDescription, messages, language = "hindi", screeningQuestions, modelName = "gemini-2.5-flash-lite", onChunk = null, cacheId = null, expiryMinutes = 20, signal = null })
{
    if(cacheId)
    {
        try
        {
            const { text, usage } = await AI.runGeminiCall({
                conversation : messages,
                cacheId : cacheId,
                modelName : modelName,
                temperature : 1,
                streaming : true,
                onChunk : onChunk,
                signal : signal
            });

            return {
                content : text,
                cacheId : cacheId,
                usage : usage,
                costPerSecond : 0
            };
        }
        catch(err)
        {
            console.error(`❌ Error in screeningCall2 with cacheId:`, err);
        }
    }

    const promptMessages = prompter.getPromptForScreeningCall({
        candidateName,
        jobTitle,
        companyName,
        jobDescription,
        messages  : [],
        language,
        screeningQuestions
    });

    const systemPromptText = promptMessages.find(m => m.role === "system")?.content || "";

    const [{ text, usage }, { cacheName: newCacheId, metrics: { costPerSecond } }] = await Promise.all([
        AI.runGeminiCall({
            conversation : messages,
            prompt : systemPromptText,
            modelName : modelName,
            temperature : 0.6,
            streaming : true,
            onChunk : onChunk,
            signal : signal
        }),
        AI.createContextCache(modelName, systemPromptText, expiryMinutes)
    ]);

    return {
        content : text,
        cacheId : newCacheId,
        usage : usage,
        costPerSecond : costPerSecond ?? 0
    };
}

async function initializeCacheForScreening({ candidateName, jobTitle, companyName, jobDescription, language = "hindi-start", screeningQuestions, modelName = "gemini-2.5-flash-lite", expiryMinutes = 20 })
{
    const promptMessages = prompter.getPromptForScreeningCall({
        candidateName,
        jobTitle,
        companyName,
        jobDescription,
        messages : [],
        language,
        screeningQuestions
    });

    const systemPromptText = promptMessages.find(m => m.role === "system")?.content || "";

    const { cacheName, metrics } = await AI.createContextCache(modelName, systemPromptText, expiryMinutes);

    return {
        cacheId : cacheName,
        costPerSecond : metrics.costPerSecond ?? 0,
        writeCost: metrics.oneTimeWriteCost ?? 0
    };
}

async function transliterate({ text, targetLanguage, targetScript, modelName = "gpt-oss" })
{
    const promptMessages = prompter.getTransliterationPrompt({
        text,
        targetLanguage,
        targetScript
    });

    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.runNoGroq({
                messages : promptMessages,
                modelName : modelName,
                streaming : false
            });

            if(!response || typeof response !== "string" || response.trim().length === 0)
            {
                throw new Error("Empty response");
            }

            return response.trim();
        }
        catch (error)
        {
            retries++;

            if (retries >= maxRetries)
            {
                return text;
            }
        }
    }
}

async function generateScreeningQuestions({ jobTitle, jobDescription, companyName, modelName = "gpt-oss" })
{
    const promptMessages = prompter.getScreeningQuestionsPrompt({
        jobTitle,
        jobDescription,
        companyName
    });

    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries)
    {
        try
        {
            const response = await AI.runNoGroq({
                messages : promptMessages,
                modelName : modelName,
                streaming : false
            });

            if (!response || typeof response !== "string" || response.trim().length === 0)
            {
                throw new Error("Empty response");
            }

            const cleaned = cleanJsonResponse(response);
            const questions = JSON.parse(cleaned);

            if (!Array.isArray(questions) || questions.length === 0)
            {
                throw new Error("Invalid questions array");
            }

            return questions;
        }
        catch (error)
        {
            retries++;

            if (retries >= maxRetries)
            {
                console.error("❌ Failed to generate screening questions:", error.message);
                return [];
            }
        }
    }
}

async function getOrCreateContextCache(cacheId, text, expiryMinutes = 20, modelName)
{
    modelName = modelName || "gemini-2.5-flash-lite";
    
    if (!cacheId)
    {
        return await AI.createContextCache(modelName, text, expiryMinutes);
    }

    const exists = await AI.checkContextCacheExists(cacheId);

    if (!exists)
    {
        return await AI.createContextCache(modelName, text, expiryMinutes);
    }

    return cacheId;
}

async function deleteContextCache(cacheId)
{
    if(!cacheId)
    {
        return;
    }

    try
    {
        await AI.deleteContextCache(cacheId);
        console.log(`🗑️ [Gemini Cache] Deleted cache: ${cacheId}`);
    }
    catch(err)
    {
        console.error(`❌ [Gemini Cache] Failed to delete cache: ${cacheId}:`, err.message);
    }
}

module.exports = {
    initScreening,
    replyChatTest,
    abuseDetectionTest,
    relevanceDetectionTest,
    answerExtractionTest,
    clarificationDetectionTest,
    clarificationQuestionTest,
    forcedOptionSelectionTest,
    acknowledgementTest,
    terminationMessageTest,
    abuseAndRelevanceDetectionTest,
    replyChat,
    forcedDecision,
    initTest,
    checkTest,
    calculateCandidateFit,
    initScreeningMessages,
    translateJsonToLanguage,
    analyzeConversation,
    screeningCall,
    transliterate,
    generateScreeningQuestions,
    isUserDoneSpeaking,
    getOrCreateContextCache,
    screeningCall2,
    initializeCacheForScreening,
    deleteContextCache
}