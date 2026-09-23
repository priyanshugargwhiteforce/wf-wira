const WiraUtility = require("./WiraUtility");
const WiraRetrieve = require("./WiraRetrieve");
const WiraPerform = require("./WiraPerform");
const WiraSocket = require("./WiraSocket");
const WiraSession = require("./WiraSession");
const WiraDatabase = require("./WiraDatabase");
const WiraQueue = require("../WiraManager/WiraQueue");
const WiraWhatsapp = require("../WiraManager/WiraWhatsapp");
const WiraGemini = require("./WiraGemini");
const WiraNotification = require("./WiraNotification");
const WiraValidation = require("./WiraValidation");
const axios = require("axios");

class WiraManager
{
    constructor(io)
    {
        this.validation = new WiraValidation();
        this.database = new WiraDatabase();

        this.queue = new WiraQueue(this.database, null, async (phone, activePrompt, sessionMetadata) =>
        {
            if(activePrompt === "profile" && sessionMetadata?.profile)
            {
                await this.perform.upsertCandidate(phone, sessionMetadata.profile);
            }
        });
        
        this.session = new WiraSession(this.database, this.queue);
        this.utility = new WiraUtility(this.session);
        this.notification = new WiraNotification(this.session);
        this.socket = new WiraSocket(io, this.notification, this.session);
        this.retrieve = new WiraRetrieve(this.database, this.utility, this.queue, this.session);
        this.perform = new WiraPerform(this.database, this.utility, this.queue, this.session);
        this.whatsapp = new WiraWhatsapp();
        this.activeControllers = new Map();
        this.fileCommands = new Set(["create-resume"]);

        this.queue.setSession(this.session);

        this.prerequisites =
        {
            getSemanticPast:
            {
                description: "Fetch semantically relevant past messages and call summaries from conversation history. Only when the candidate explicitly references something specific from a prior conversation that is clearly not visible in the current 4-message window. Temporal words alone ('earlier', 'before') are not enough — the reference must point to something substantive that is missing from the window.",
                resolve: async (manager, phone, platform, semanticQuery, excludeIds) =>
                {
                    const result = await manager.retrieve.fetchRelevantPast(phone, semanticQuery, excludeIds, platform, 30, 5);

                    const raw = (result.data ?? []).map((data) => { 
                        return { 
                            ...data, 
                            source: data.source ?? platform 
                        } 
                    });

                    const formatted = raw.map((r) => { 
                        return manager.utility.formatSemanticContext(r.source, r) 
                    }).filter(Boolean).join("\n\n");

                    return {
                        raw: raw,
                        formatted: formatted
                    };
                }
            },
            getBusinessInfo:
            {
                description: "Fetch relevant chunks from the business knowledge base. Only when the candidate explicitly asks about company services, branches, office locations, contact details, or job categories offered by the business. Do NOT use for job search requests, technology names, skills, or role titles.",
                resolve: async (manager, semanticQuery) =>
                {
                    const result = await manager.retrieve.fetchRelevantChunks(semanticQuery);

                    const raw = (result.data ?? []).map((data) => {
                        return { 
                            ...data, 
                            source: "Business" 
                        }
                    });
                    const formatted = raw.map((r) => {
                        return manager.utility.formatSemanticContext("Business", r)
                    }).filter(Boolean).join("\n\n");

                    return {
                        raw: raw,
                        formatted: formatted
                    };
                }
            },
            getSemanticFiles:
            {
                description: "Semantically search the candidate's uploaded files. Only when the candidate explicitly and directly references one of their uploaded files or asks about something that requires reading their actual document. A passing mention of skills, experience, or a CV does NOT qualify. Clear triggers: 'check my resume', 'what's on my CV', 'the certificate I uploaded'.",
                resolve: async (manager, phone, semanticQuery, excludeFileNames) =>
                {
                    const result = await manager.retrieve.fetchRelevantFiles(phone, semanticQuery, excludeFileNames, [], 30, 5);

                    const raw = (result.data ?? []).map((data) => {
                        return { 
                            ...data, 
                            source: "Artifact" 
                        }
                    });

                    const formatted = raw.map((r) => { 
                        return manager.utility.formatSemanticContext("Artifact", r)
                    }).filter(Boolean).join("\n\n");

                    return {
                        raw: raw,
                        formatted: formatted
                    };
                }
            },
            getLastOutput:
            {
                description: "Fetch the data payload displayed to the candidate in the last reply. Only when the candidate refers to something currently visible on their screen from the last reply — 'this one', 'the first job', 'that listing'. Not for general questions about jobs.",
                resolve: async (manager, phone) =>
                {
                    const session = await manager.session.getSession(phone);
                    return session?.lastOutput ?? null;
                }
            },
            getSemantic:
            {
                description: "Fan-out semantic search across all context stores — past messages, uploaded files, and business knowledge. Use when context is clearly missing but the source is ambiguous. Always prefer this over combining getSemanticPast, getSemanticFiles, or getBusinessInfo when the source is uncertain. Never combine getSemantic with any of those three in the same output.",
                resolve: async (manager, phone, platform, semanticQuery, excludeIds, excludeFileNames) =>
                {
                    const [past, business, files] = await Promise.all([
                        manager.prerequisites.getSemanticPast.resolve(manager, phone, platform, semanticQuery, excludeIds),
                        manager.prerequisites.getBusinessInfo.resolve(manager, semanticQuery),
                        manager.prerequisites.getSemanticFiles.resolve(manager, phone, semanticQuery, excludeFileNames)
                    ]);

                    const all = [
                        ...past.raw,
                        ...business.raw,
                        ...files.raw
                    ];

                    all.sort((a, b) => b.similarity - a.similarity);
                    const top7 = all.slice(0, 7);

                    const pastTop = top7.filter(r => r.source === "App" || r.source === "Whatsapp" || r.source === "Call");
                    const businessTop = top7.filter(r => r.source === "Business");
                    const filesTop = top7.filter(r => r.source === "Artifact");

                    return {
                        semanticPast: pastTop.map(r => manager.utility.formatSemanticContext(r.source, r)).filter(Boolean).join("\n\n"),
                        businessInfo: businessTop.map(r => manager.utility.formatSemanticContext("Business", r)).filter(Boolean).join("\n\n"),
                        semanticFiles: filesTop.map(r => manager.utility.formatSemanticContext("Artifact", r)).filter(Boolean).join("\n\n")
                    };
                }
            }
        };

        this.retrieveSkills =
        {
            getProfile:
            {
                description: "Fetch the candidate's full profile from the central server. Use when Wira needs the candidate's background, skills, experience, or education to answer a question, check eligibility, or perform a profile-dependent action.",
                command: "fetch-candidate",
                shape: 1,
                resolve: async (manager, phone, instructionData) =>
                {
                    const output = await manager.retrieve.fetchCandidate(phone);

                    if(!output.success)
                    {
                        let data = null;
                        const session = await manager.session.getSession(phone);
                        if(session && (session.user))
                        {
                            data = session.user;
                            output.data = data;
                        }
                    }
                    
                    return { 
                        output: output 
                    };
                }
            },
            checkSubscription:
            {
                description: "Check whether the candidate is currently subscribed to periodic job recommendations. Use when the candidate asks about their subscription status or before toggling subscription.",
                command: "fetch-subscription-status",
                shape: 1,
                resolve: async (manager, phone, instructionData) =>
                {
                    const output = await manager.retrieve.isSubscribed(phone);

                    return { 
                        output: output 
                    };
                }
            },
            fetchSkills:
            {
                description: "Inject one or more perform or retrieval skills into this turn's context. Use when the router missed a skill you need to complete the candidate's request. Only request skills by their exact key name.",
                command: "fetch-skills",
                shape: 1,
                resolve: async (manager, phone, instructionData) =>
                {
                    const skills = instructionData?.skills ?? [];
                    const prompts = skills.map(skillKey =>
                    {
                        const skill = manager.retrieveSkills[skillKey] ?? manager.performSkills[skillKey] ?? null;
                        return skill?.prompt ?? null;
                    }).filter(Boolean);

                    return {
                        output: {
                            statusCode: 200,
                            success: true,
                            message: "Skills fetched.",
                            data: { 
                                skills: prompts 
                            }
                        }
                    };
                }
            },
            getJobData:
            {
                description: "Fetch full details of one or more specific jobs by their IDs. Use when specific jobIds are already known and referenced in the conversation and the user wants details about those exact jobs.",
                command: "fetch-jobs",
                shape: 2,
                resolve: async (manager, phone, instructionData) =>
                {
                    const jobIds = instructionData?.jobIds ?? [];
                    const output = await manager.retrieve.fetchJobs(jobIds, phone);

                    if(!output.success || !Array.isArray(output.data?.jobs) || output.data.jobs.length === 0)
                    {
                        return { 
                            output: output 
                        };
                    }

                    const session = await manager.session.getSession(phone);
                    const wishlistIds = session?.wishlistIds ?? [];
                    const appliedJobIds = session?.appliedJobIds ?? [];
                    const jobs = output.data.jobs;
                    const formatted = manager.utility.formatLastOutputForAI(jobs, wishlistIds, appliedJobIds);

                    return {
                        output: {
                            ...output,
                            data: {
                                jobs: formatted
                            }
                        },
                        jobs: jobs
                    };
                }
            },
            getTestResults:
            {
                description: "Fetch the candidate's past interview preparation test results for one or more specific jobs. Use when the candidate asks how they performed in a preparation test.",
                command: "fetch-tests",
                shape: 2,
                resolve: async (manager, phone, instructionData) =>
                {
                    const jobIds = instructionData?.jobIds ?? [];
                    const output = await manager.retrieve.fetchTests(phone, jobIds);

                    return { 
                        output: output 
                    };
                }
            },
            getScreeningResults:
            {
                description: "Fetch the candidate's past screening results for one or more specific jobs. Use when the candidate asks about their past screening performance or outcome for a specific job.",
                command: "fetch-screenings",
                shape: 2,
                resolve: async (manager, phone, instructionData) =>
                {
                    const jobIds = instructionData?.jobIds ?? [];
                    const output = await manager.retrieve.fetchScreenings(phone, jobIds);

                    return { 
                        output: output 
                    };
                }
            },
            getAppliedStatus:
            {
                description: "Fetch pipeline status for one or more specific applied jobs. Use when the user is asking about the status, stage, or progress of a specific job application they have already made.",
                command: "fetch-applied-status",
                shape: 2,
                resolve: async (manager, phone, instructionData) =>
                {
                    const jobIds = instructionData?.jobIds ?? [];
                    const output = await manager.retrieve.fetchJobStatus(phone, jobIds);

                    return { 
                        output: output 
                    };
                }
            },
            checkWishlistAndAppliedStatus:
            {
                description: "Check whether specific jobs are wishlisted or applied to by the candidate. Use when the candidate asks if they have saved or applied to a specific job, or before toggling wishlist.",
                command: "fetch-wishlist-status",
                shape: 2,
                resolve: async (manager, phone, instructionData) =>
                {
                    const jobIds = instructionData?.jobIds ?? [];
                    const output = await manager.retrieve.fetchIsWishlistedOrApplied(phone, jobIds);

                    return { 
                        output 
                    };
                }
            },
            getWishlist:
            {
                description: "Fetch the candidate's wishlisted jobs with no specific search query. Use when the user is asking to see their wishlist without describing any particular job type or preference.",
                command: "fetch-wishlist",
                shape: 3,
                resolve: async (manager, phone, instructionData) =>
                {
                    const session = await manager.session.getSession(phone);
                    const wishlistIds = session?.wishlistIds ?? [];
                    const perPage = instructionData?.perPage ?? 10;
                    const pageNo = instructionData?.pageNo ?? 1;
                    const output = await manager.retrieve.fetchWishlistedJobs(phone, perPage, pageNo, wishlistIds);

                    if(!output.success || !Array.isArray(output.data?.jobs) || output.data.jobs.length === 0)
                    {
                        return { 
                            output: output 
                        };
                    }

                    const jobs = output.data.jobs;
                    const formatted = manager.utility.formatLastOutputForAI(jobs, wishlistIds, appliedJobIds);

                    return {
                        output: {
                            ...output,
                            data: {
                                jobs: formatted
                            }
                        },
                        jobs: jobs
                    };
                }
            },
            getAppliedJobs:
            {
                description: "Fetch the candidate's applied jobs with no specific search query. Use when the user is asking to see all their applications or check their application history without filtering by job type.",
                command: "fetch-applied",
                shape: 3,
                resolve: async (manager, phone, instructionData) =>
                {
                    const session = await manager.session.getSession(phone);
                    const appliedJobIds = session?.appliedJobIds ?? [];
                    const perPage = instructionData?.perPage ?? 10;
                    const pageNo = instructionData?.pageNo ?? 1;
                    const output = await manager.retrieve.fetchAppliedJobs(phone, perPage, pageNo, appliedJobIds);

                    if(!output.success || !Array.isArray(output.data?.jobs) || output.data.jobs.length === 0)
                    {
                        return { 
                            output: output 
                        };
                    }

                    const wishlistIds = session?.wishlistIds ?? [];
                    const jobs = output.data.jobs;
                    const formatted = manager.utility.formatLastOutputForAI(jobs, wishlistIds, appliedJobIds);

                    return {
                        output: {
                            ...output,
                            data: {
                                jobs: formatted
                            }
                        },
                        jobs: jobs
                    };
                }
            },
            searchJobs:
            {
                description: "Run a semantic search for jobs matching the user's query or profile. Use when the user is asking to see, find, or discover jobs — either by describing what they want or asking Wira to suggest suitable ones.",
                command: "fetch-semantic-jobs",
                shape: 4,
                resolve: async (manager, phone, instructionData) =>
                {
                    const sf = instructionData?.searchFilters ?? {};
                    const output = await manager.retrieve.fetchSemanticJobs(sf.embed ?? "", sf.filters ?? {}, sf.jobIds ?? [], sf.perPage ?? 10, sf.pageNo ?? 1, phone);

                    if(!output.success || !Array.isArray(output.data?.jobs) || output.data.jobs.length === 0)
                    {
                        return { 
                            output: output 
                        };
                    }

                    const session = await manager.session.getSession(phone);
                    const wishlistIds = session?.wishlistIds ?? [];
                    const appliedJobIds = session?.appliedJobIds ?? [];
                    const jobs = output.data.jobs;
                    const formatted = manager.utility.formatLastOutputForAI(jobs, wishlistIds, appliedJobIds);

                    return {
                        output: {
                            ...output,
                            data: {
                                jobs: formatted
                            }
                        },
                        jobs: jobs
                    };
                }
            },
            searchWishlist:
            {
                description: "Semantically search within the candidate's wishlisted jobs using a description or preference. Use when the user is asking about their wishlist but has described what kind of job they are looking for.",
                command: "fetch-semantic-wishlist",
                shape: 4,
                resolve: async (manager, phone, instructionData) =>
                {
                    const sf = instructionData?.searchFilters ?? {};
                    const output = await manager.retrieve.fetchSemanticWishlist(phone, sf.embed ?? "", sf.filters ?? {}, sf.perPage ?? 10, sf.pageNo ?? 1);

                    if(!output.success || !Array.isArray(output.data?.jobs) || output.data.jobs.length === 0)
                    {
                        return { 
                            output: output 
                        };
                    }

                    const session = await manager.session.getSession(phone);
                    const wishlistIds = session?.wishlistIds ?? [];
                    const appliedJobIds = session?.appliedJobIds ?? [];
                    const jobs = output.data.jobs;
                    const formatted = manager.utility.formatLastOutputForAI(jobs, wishlistIds, appliedJobIds);

                    return {
                        output: {
                            ...output,
                            data: {
                                jobs: formatted
                            }
                        },
                        jobs: jobs
                    };
                }
            },
            searchAppliedJobs:
            {
                description: "Semantically search within the candidate's applied jobs using a description or preference. Use when the user references their applied jobs but has described a specific role, company, or location to narrow it down.",
                command: "fetch-semantic-applied",
                shape: 4,
                resolve: async (manager, phone, instructionData) =>
                {
                    const sf = instructionData?.searchFilters ?? {};
                    const output = await manager.retrieve.fetchSemanticApplied(phone, sf.embed ?? "", sf.filters ?? {}, sf.perPage ?? 10, sf.pageNo ?? 1);

                    if(!output.success || !Array.isArray(output.data?.jobs) || output.data.jobs.length === 0)
                    {
                        return { 
                            output: output 
                        };
                    }

                    const session = await manager.session.getSession(phone);
                    const wishlistIds = session?.wishlistIds ?? [];
                    const appliedJobIds = session?.appliedJobIds ?? [];
                    const jobs = output.data.jobs;
                    const formatted = manager.utility.formatLastOutputForAI(jobs, wishlistIds, appliedJobIds);

                    return {
                        output: {
                            ...output,
                            data: {
                                jobs: formatted
                            }
                        },
                        jobs: jobs
                    };
                }
            },
            getSemanticPast:
            {
                description: "Semantically search past messages and call summaries across all platforms. Use when the candidate references something from a past conversation or when context from history would improve the response.",
                command: "fetch-semantic-past",
                shape: 5,
                resolve: async (manager, phone, instructionData) =>
                {
                    const embed = instructionData?.embed ?? "";
                    const output = await manager.retrieve.fetchRelevantPast(phone, embed, [], "App", 30, 5);

                    return { 
                        output: output 
                    };
                }
            },
            getBusinessInfo:
            {
                description: "Fetch relevant chunks from the company knowledge base — services, branches, processes, contact details, job categories. Use when the candidate asks about the company or any entity-related question.",
                command: "fetch-business-info",
                shape: 5,
                resolve: async (manager, phone, instructionData) =>
                {
                    const embed = instructionData?.embed ?? "";
                    const output = await manager.retrieve.fetchRelevantChunks(embed);

                    return { 
                        output: output 
                    };
                }
            },
            getSemanticFiles:
            {
                description: "Semantically search the candidate's uploaded files — resumes, certificates, documents. Use when the candidate references a file or when file content would improve the response.",
                command: "fetch-semantic-files",
                shape: 6,
                resolve: async (manager, phone, instructionData) =>
                {
                    const embed = instructionData?.embed ?? "";
                    const excludeFileNames = instructionData?.excludeFileNames ?? [];
                    const includeFileNames = instructionData?.includeFileNames ?? [];
                    const output = await manager.retrieve.fetchRelevantFiles(phone, embed, excludeFileNames, includeFileNames, 30, 5);

                    return { 
                        output: output 
                    };
                }
            },
            getFileContent:
            {
                description: "Fetch the full content of one or more specific files by name. Use when the candidate explicitly references a specific file and full content is needed rather than semantic chunks.",
                command: "fetch-file-content",
                shape: 6,
                resolve: async (manager, phone, instructionData) =>
                {
                    const fileNames = (instructionData?.fileNames ?? []).map(n => ({ fileName: n }));
                    const output = await manager.retrieve.fetchFileData(fileNames);
                    
                    return { 
                        output: output 
                    };
                }
            }
        };

        this.shapes = 
        {
            1: `{ "instructionData": null } or { "instructionData": { "skills": ["array of skill names to inject this turn"] } }`,
            2: `{ "instructionData": { "jobIds": ["array of the actual job IDs being referenced in the conversation"] } }`,
            3: `{ "instructionData": { "perPage": 10, "pageNo": 1 } }`,
            4: `{ "instructionData": { "searchFilters": { "embed": "build a natural language search query from the full conversation context describing what the candidate is looking for", "filters": { "country": "candidate's preferred country or omit", "state": "candidate's preferred state or omit", "city": "candidate's preferred city or omit", "location": "specific location string or omit", "minSalary": "minimum salary expectation as number or omit", "maxSalary": "maximum salary expectation as number or omit", "minExperience": "minimum years of experience as number or omit", "maxExperience": "maximum years of experience as number or omit", "industry": "industry or domain string or omit" }, "jobIds": "array of specific jobIds to restrict search to, or omit", "perPage": "number of results per page or omit", "pageNo": "page number or omit" } } }`,
            5: `{ "instructionData": { "embed": "build a natural language search query from the full conversation context describing what past information or topic to retrieve" } }`,
            6: `{ "instructionData": { "embed": "build a natural language search query from the full conversation context describing what to find in the candidate's files", "includeFileNames": "array of specific file names to search within, or omit", "excludeFileNames": "array of file names to exclude from search, or omit" } }`,
        };

        this.performSkills =
        {
            toggleWishlist:
            {
                description: "Add or remove one or more jobs from the candidate's wishlist. Use when the candidate explicitly asks to save or unsave a job.",
                command: "update-candidate-wishlist",
                resolve: async (manager, phone, instructionData) =>
                {
                    const data = instructionData?.data ?? [];
                    const output = await manager.perform.toggleWishlist(phone, data);

                    if(output.success)
                    {
                        const session = await manager.session.getSession(phone);
                        if(session)
                        {
                            const wishlistIds = session.wishlistIds ?? [];

                            for(const entry of data)
                            {
                                const id = entry.jobId;
                                const idx = wishlistIds.indexOf(id);

                                if(entry.action === "add" && idx === -1)
                                {
                                    wishlistIds.push(id);
                                }
                                else if(entry.action === "remove" && idx !== -1)
                                {
                                    wishlistIds.splice(idx, 1);
                                }
                            }

                            session.wishlistIds = wishlistIds;
                            await manager.session.updateSession(phone, session);
                        }
                    }

                    return { 
                        output: output 
                    };
                }
            },
            applyJobs:
            {
                description: "Apply the candidate to one or more jobs. Use when the user has explicitly confirmed they want to apply to specific jobs and the jobIds are known.",
                command: "apply-jobs",
                resolve: async (manager, phone, instructionData) =>
                {
                    const jobIds = instructionData?.jobIds ?? [];
                    const output = await manager.perform.applyJobs(phone, jobIds);

                    if(output.success)
                    {
                        const session = await manager.session.getSession(phone);
                        if(session)
                        {
                            const appliedJobIds = session.appliedJobIds ?? [];

                            for(const id of jobIds)
                            {
                                if(!appliedJobIds.includes(id))
                                {
                                    appliedJobIds.push(id);
                                }
                            }

                            session.appliedJobIds = appliedJobIds;
                            await manager.session.updateSession(phone, session);
                        }
                    }

                    return { 
                        output: output 
                    };
                }
            },
            notInterested:
            {
                description: "Mark one or more applied jobs as not interested. Use when the user explicitly says they are not interested in a job they have previously applied to.",
                command: "not-interested",
                resolve: async (manager, phone, instructionData) =>
                {
                    const jobIds = instructionData?.jobIds ?? [];
                    const output = await manager.perform.notInterested(phone, jobIds);

                    return { 
                        output: output 
                    };
                }
            },
            subscribe:
            {
                description: "Subscribe the candidate to periodic job recommendations. Use when the user explicitly asks to start receiving job recommendations from Wira.",
                command: "subscribe",
                resolve: async (manager, phone, instructionData) =>
                {
                    const output = await manager.perform.toggleSubscribe(phone, "subscribe");

                    return { 
                        output: output 
                    };
                }
            },
            unsubscribe:
            {
                description: "Unsubscribe the candidate from periodic job recommendations. Use when the user explicitly asks to stop receiving job recommendations from Wira.",
                command: "unsubscribe",
                resolve: async (manager, phone, instructionData) =>
                {
                    const output = await manager.perform.toggleSubscribe(phone, "unsubscribe");
                    return { 
                        output: output 
                    };
                }
            },
            interviewResponse:
            {
                description: "Submit the candidate's response to an interview invitation — confirmed, rejected, or reschedule requested. Use when the user is responding to an interview scheduled for them.",
                command: "interview-schedule",
                resolve: async (manager, phone, instructionData) =>
                {
                    const interview = instructionData?.interview ?? {};
                    const output = await manager.perform.interviewResponse(phone, [interview]);

                    return { 
                        output: output 
                    };
                }
            },
            shortlistCandidate:
            {
                description: "Shortlist the candidate for one or more specific jobs. Use when a recruiter-side shortlisting action is explicitly required — typically triggered after the candidate expresses strong interest or has been confirmed eligible for a role.",
                command: "shortlist-candidate",
                resolve: async (manager, phone, instructionData) =>
                {
                    const jobIds = instructionData?.jobIds ?? [];
                    const output = await manager.perform.shortlistCandidate(phone, jobIds);
                    return { 
                        output: output 
                    };
                }
            },
            setReminder:
            {
                description: "Schedule a reminder for the candidate at a specific date and time. Use when the user asks Wira to remind them about something — an interview, a deadline, a follow-up.",
                command: "reminder-set",
                resolve: async (manager, phone, instructionData) =>
                {
                    return {
                        output: {
                            statusCode: 200,
                            success: true,
                            message: "Reminder set successfully.",
                            data: null
                        }
                    };
                }
            }
        };

        this.specialists =
        {
            conversation:
            {
                description: "The main Wira conversation prompt. Routes candidate intent, retrieves data, performs actions, and hands off to specialists when needed.",
                resolve: this.conversationHandler
            },
            eligibility:
            {
                description: "Analyses the candidate's fit for a specific job and produces a structured breakdown of strengths, gaps, and suggestions. Single-shot — exits after analysis. REQUIRED CONTRACT: any prompt forwarding to eligibility MUST include a fetch-jobs instruction in the same instructions array with the instructionData.jobIds set to the exact job being analysed. Forwarding to eligibility without fetch-jobs is invalid — the specialist cannot function without the job data. Never forward here speculatively or before the jobId is known.",
                resolve: this.eligibilityHandler
            },
            profile:
            {
                description: "Manages the full profile collection flow. Either parses an uploaded resume or collects data conversationally field by field. Saves partial data if the user drifts. Has a 30-minute BullMQ timeout safety net.",
                resolve: this.profileHandler
            },
            examiner:
            {
                description: "Conducts an interview preparation test for a specific job. Asks questions one at a time, scores each answer, stores results. Session stays open if the user drops off.",
                resolve: this.examinerHandler
            },
            screening:
            {
                description: "Conducts a job-specific screening. Asks relocation, salary, notice period, and role questions. Normalises answers to recruiter-readable English. Produces an interest level and score on exit.",
                resolve: this.screeningHandler
            },
            resume:
            {
                description: "Generates an ATS-friendly resume from the candidate's profile. Checks profile completeness first — reverts silently if data is insufficient.",
                resolve: this.resumeHandler
            },
        };

        this.AI = new WiraGemini(this.session, this.database, this.prerequisites, this.retrieveSkills, this.performSkills, this.specialists, this.shapes);
    }

    async authenticate(role, socket = null, auth = null)
    {
        //CHECKING IF BASICS ARE COVERED.
        if(!role || (role !== "user" && role !== "server"))
        {
            return {
                statusCode: 400,
                success: false,
                message: "Invalid or missing role. Must be user or server.",
                data: null
            };
        }

        if(!socket && !auth)
        {
            return {
                statusCode: 400,
                success: false,
                message: "Either socket or auth must be provided.",
                data: null
            };
        }

        //CHECKING IF USER
        if(role === "user")
        {
            //CHECKING PLATFORM'S REQUIRED FIELDS
            const PLATFORM_REQUIRED_FIELDS = {
                App: ["candidateId", "candidateName", "phone", "email", "webName", "platform"],
                Web: ["candidateId", "candidateName", "phone", "email", "webName", "platform"],
                Whatsapp: ["phone"]
            };

            const PLATFORM_CROSS_CHECK_FIELDS = {
                App: ["candidateId", "candidateName", "phone", "email"],
                Web: ["candidateId", "candidateName", "phone", "email"],
                Whatsapp: ["phone"]
            };

            const raw = socket ? {
                candidateId: socket.handshake.auth.candidateId || socket.handshake.query.candidateId || null,
                candidateName: socket.handshake.auth.candidateName || socket.handshake.query.candidateName || null,
                phone: socket.handshake.auth.phone || socket.handshake.query.phone || null,
                email: socket.handshake.auth.email || socket.handshake.query.email || null,
                webName: socket.handshake.auth.webName || socket.handshake.query.webName || "White Force",
                platform: socket.handshake.auth.platform || socket.handshake.query.platform || null,
                fcmToken: socket.handshake.auth.fcmToken || socket.handshake.query.fcmToken || null,
            } : auth;

            if(!raw.platform || !PLATFORM_REQUIRED_FIELDS[raw.platform])
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "Invalid or missing platform. Must be App, Web, or Whatsapp.",
                    data: null
                };
            }

            const requiredFields = PLATFORM_REQUIRED_FIELDS[raw.platform];
            const missing = requiredFields.filter(field => !raw[field]);

            if(missing.length > 0)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "Missing credentials.",
                    data: { 
                        missing 
                    }
                };
            }

            //CHECKING IF SESSION ALREADY EXISTS FOR USER
            const sessionKey = `wira-ai:${raw.phone}`;
            const existingRaw = await this.session.getSession(raw.phone);

            if(existingRaw)
            {
                const existingSession = existingRaw;
                const crossCheckFields = PLATFORM_CROSS_CHECK_FIELDS[raw.platform];

                const crossCheckMap = {
                    candidateId: { 
                        sent: String(raw.candidateId), 
                        existing: String(existingSession.user.candidateId) 
                    },
                    candidateName: { 
                        sent: raw.candidateName, 
                        existing: existingSession.user.fullName 
                    },
                    phone: { 
                        sent: raw.phone, 
                        existing: existingSession.user.phone 
                    },
                    email: { 
                        sent: raw.email, 
                        existing: existingSession.user.email 
                    }
                };

                const mismatches = crossCheckFields.filter(field =>
                {
                    const entry = crossCheckMap[field];

                    if(!entry.existing)
                    {
                        return false;
                    }

                    return entry.sent !== entry.existing;
                });

                if(mismatches.length > 0)
                {
                    return {
                        statusCode: 401,
                        success: false,
                        message: "Invalid credentials.",
                        data: { 
                            mismatches 
                        }
                    };
                }

                if(socket)
                {
                    await this.session.addSocket(raw.phone, raw.platform, socket.id, raw.fcmToken ?? null);

                    socket.user = { 
                        ...existingSession.user, 
                        webName: raw.webName, 
                        platform: raw.platform 
                    };

                    socket.join(sessionKey);
                }

                return { 
                    statusCode: 200,
                    success: true,
                    message: "Authenticated successfully.",
                    data: null
                };
            }

            //CREATING A NEW USER SESSION.
            let userData = null;

            try
            {
                const profileResult = await this.retrieve.fetchCandidate(raw.phone);

                if(profileResult.success)
                {
                    userData = profileResult.data;
                }
                else
                {
                    userData = {
                        candidateId: raw.candidateId ?? null,
                        fullName: raw.candidateName ?? null,
                        phone: raw.phone ?? null,
                        email: raw.email ?? null,
                        resume: null,
                        resumeParserJson: null,
                        preferredLocation: null,
                        noticePeriod: null,
                        industry: null,
                        expectedSalary: null,
                        experience: null,
                        totalExperience: null,
                        experienceData: [],
                        educationData: [],
                        gender: null,
                        maritalStatus: null,
                        relocate: null,
                        language: [],
                        communication: null,
                        dateOfBirth: null,
                        skills: [],
                        country: null,
                        state: null,
                        city: null,
                        address: null,
                        postelCode: null,
                        source: null
                    };
                }
            }
            catch(error)
            {
                return {
                    statusCode: 503,
                    success: false,
                    message: "Authentication service unavailable. Please try again.",
                    data: null
                };
            }

            //CROSS CHECKING IF USER DATA MATCHES WITH THE SENT DATA.
            if(userData.candidateId)
            {
                const crossCheckFields = PLATFORM_CROSS_CHECK_FIELDS[raw.platform];

                const frontendMap = {
                    candidateId: { 
                        sent: String(raw.candidateId), 
                        db: String(userData.candidateId) 
                    },
                    candidateName: { 
                        sent: raw.candidateName, 
                        db: userData.fullName 
                    },
                    phone: { 
                        sent: raw.phone, 
                        db: userData.phone 
                    },
                    email: { 
                        sent: raw.email, 
                        db: userData.email 
                    }
                };

                const mismatches = crossCheckFields.filter(field =>
                {
                    const entry = frontendMap[field];

                    if(!entry.db)
                    {
                        return false;
                    }

                    return entry.sent !== entry.db;
                });

                if(mismatches.length > 0)
                {
                    return {
                        statusCode: 401,
                        success: false,
                        message: "Invalid credentials.",
                        data: { 
                            mismatches 
                        }
                    };
                }
            }

            //CREATING A NEW USER SESSION.
            await this.session.createSession(raw.phone, userData, raw.platform, socket?.id ?? null, raw.webName, raw.fcmToken ?? null);

            (async () =>
            {
                try
                {
                    const [wishlistResult, appliedResult] = await Promise.all([
                        axios.post("https://white-force.com/plus/api/candidate-wishlist-ids", { mobile: raw.phone }, { headers: { "x-api-key": process.env.WIRA_API_KEY } }),
                        axios.post("https://white-force.com/plus/api/candidate-applied-ids", { mobile: raw.phone }, { headers: { "x-api-key": process.env.WIRA_API_KEY } })
                    ]);

                    const session = await this.session.getSession(raw.phone);
                    if(!session)
                    {
                        return;
                    }

                    session.wishlistIds = wishlistResult.data?.status && Array.isArray(wishlistResult.data?.data) ? wishlistResult.data.data : [];
                    session.appliedJobIds = appliedResult.data?.status && Array.isArray(appliedResult.data?.data) ? appliedResult.data.data : [];

                    await this.session.updateSession(raw.phone, session);
                }
                catch(error)
                {
                    console.error("❌ Pre-warm wishlist/applied failed:", error.message);
                }
            })();

            if(socket)
            {
                socket.user = { 
                    ...userData, 
                    webName: raw.webName, 
                    platform: raw.platform 
                };

                socket.join(sessionKey);
            }

            return {
                statusCode: 200, 
                success: true,
                message: "Authenticated successfully.",
                data: null 
            };
        }

        //CHECKING IF SERVER
        if(role === "server")
        {
            const raw = auth;

            if(!raw?.phone)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "Missing phone number.",
                    data: null
                };
            }

            if(!raw?.webName)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "Missing webName.",
                    data: null
                };
            }

            return {
                statusCode: 200, 
                success: true,
                message: "Authenticated successfully.",
                data: null 
            };
        }
    }

    async window(socket, auth, body, callback)
    {
        try
        {
            const phone = socket ? (socket.handshake.auth.phone || socket.handshake.query.phone) : auth?.phone;
            const session = await this.session.getSession(phone);

            if(!session)
            {
                this.socket.handleCallBack(
                    callback, 
                    401, 
                    false, 
                    "Session not found.", 
                    null
                );

                return;
            }

            const window = body?.window ?? "App";
            const platform = socket ? socket.user.platform : auth?.platform;

            const result = await this.database.onWindow(
                this.session,
                session.user.email,
                session.user.phone,
                session.user.candidateId,
                session.webName,
                platform,
                session.user,
                window
            );

            if(!result || !result.success)
            {
                this.socket.handleCallBack(
                    callback, 
                    result?.statusCode ?? 500, 
                    false, 
                    result?.message ?? "Failed to load chat window.", 
                    null
                );

                return;
            }

            const processing = platform === "Whatsapp" ? session.processing.whatsapp : session.processing.app;
            this.socket.handleCallBack(
                callback, 
                result.statusCode, 
                true, 
                result.message ?? "Chat window loaded successfully.",
                {
                    ...result.data,
                    processing: processing
                }
            );
        }
        catch(error)
        {
            console.error("❌ onWindow failed:", error.message);
            
            this.socket.handleCallBack(
                callback, 
                500, 
                false, 
                "Internal error loading chat window.", 
                null
            );
        }
    }

    async scroll(socket, auth, body, callback)
    {
        try
        {
            const phone = socket ? (socket.handshake.auth.phone || socket.handshake.query.phone) : auth?.phone;
            const session = await this.session.getSession(phone);

            if(!session)
            {
                this.socket.handleCallBack(
                    callback, 
                    401, 
                    false, 
                    "Session not found.", 
                    null
                );

                return;
            }

            const window = body?.window ?? "App";
            const page = body?.page ?? 1;
            const limit = body?.limit ?? 40;

            const result = await this.database.onScroll(
                this.session,
                session.user.email,
                session.user.phone,
                session.user.candidateId,
                session.webName,
                window,
                page,
                limit
            );

            if(!result || !result.success)
            {
                this.socket.handleCallBack(
                    callback, 
                    result?.statusCode ?? 500, 
                    false, 
                    result?.message ?? "Failed to load messages.", 
                    null
                );

                return;
            }

            this.socket.handleCallBack(
                callback, 
                result.statusCode, 
                true, 
                result.message ?? "Messages loaded successfully.", 
                result.data
            );
        }
        catch(error)
        {
            console.error("❌ onScroll failed:", error.message);

            this.socket.handleCallBack(
                callback, 
                500, 
                false, 
                "Internal error loading messages.", 
                null
            );
        }
    }

    async abort(socket, auth, body, callback)
    {
        try
        {
            const phone = socket ? (socket.handshake.auth.phone || socket.handshake.query.phone) : auth?.phone;

            if(!phone)
            {
                return this.socket.handleCallBack(
                    callback, 
                    400, 
                    false, 
                    "Missing phone.", 
                    null
                );
            }

            const controller = this.activeControllers.get(phone);

            if(!controller)
            {
                return this.socket.handleCallBack(
                    callback, 
                    200, 
                    true, 
                    "Nothing to abort.", 
                    null
                );
            }

            controller.abort();
            this.activeControllers.delete(phone);

            const currentSession = await this.session.getSession(phone);
            if(currentSession)
            {
                currentSession.processing.app = false;
                currentSession.processing.whatsapp = false;
                await this.session.updateSession(phone, currentSession);
            }

            return this.socket.handleCallBack(
                callback, 
                200, 
                true, 
                "Aborted successfully.", 
                null
            );
        }
        catch(error)
        {
            console.error("❌ abort failed:", error.message);

            return this.socket.handleCallBack(
                callback, 
                500, 
                false, 
                "Internal error.", 
                null
            );
        }
    }

    async message(socket, auth, body, callback)
    {
        try
        {
            const role = body?.role;
            const phone = socket ? (socket.handshake.auth.phone || socket.handshake.query.phone) : auth?.phone;

            if(!role || role !== "user")
            {
                return this.socket.handleCallBack(
                    callback,
                    400,
                    false,
                    "Invalid or missing role. Must be user.",
                    null
                );
            }

            if(!phone)
            {
                return this.socket.handleCallBack(
                    callback,
                    400,
                    false,
                    "Missing phone.",
                    null
                );
            }

            const session = await this.session.getSession(phone);

            if(!session)
            {
                return this.socket.handleCallBack(
                    callback,
                    401,
                    false,
                    "Session not found.",
                    null
                );
            }

            const platform = socket ? socket.user.platform : auth?.platform;

            switch(platform)
            {
                case "App":
                case "Web":
                {
                    const result = await this.validation.validateAppMessage(body, session);

                    if(!result.success)
                    {
                        return this.socket.handleCallBack(
                            callback,
                            result.statusCode,
                            false,
                            result.message,
                            result.data
                        );
                    }

                    if(!session.processing || typeof session.processing !== "object")
                    {
                        session.processing = {
                            app: false,
                            whatsapp: false
                        };
                    }

                    if(session.processing.app)
                    {
                        return this.socket.handleCallBack(
                            callback,
                            429,
                            false,
                            "Already processing a message.",
                            null
                        );
                    }

                    const saved = await this.database.saveMessage(
                        this.session,
                        phone,
                        platform,
                        session.webName,
                        {
                            role: "user",
                            content: body.content ?? "",
                            urls: body.urls ?? [],
                            jobIds: body.jobIds ?? [],
                            files: body.files ?? null,
                            instructionData: null,
                            isServer: false,
                            metadata: body.metadata ?? null,
                            promptCosts: null,
                            cancelled: false,
                            cleanContent: null
                        }
                    );

                    if(!saved.success)
                    {
                        return this.socket.handleCallBack(
                            callback,
                            500,
                            false,
                            "Failed to save message.",
                            null
                        );
                    }

                    body._userMessageId = saved.data?.id ?? null;
                    const controller = new AbortController();
                    this.activeControllers.set(phone, controller);

                    //session.processing.app = true;
                    //await this.session.updateSession(phone, session);

                    await this.socket.forward(
                        phone, 
                        "onChunk", 
                        { 
                            role: "assistant", 
                            chunk: "Analysing...",
                            new: true 
                        }, 
                        true, 
                        false
                    );

                    await this.socket.forward(
                        phone, 
                        "onProcessing", 
                        { 
                            processing: true,
                            file: false 
                        }, 
                        false, 
                        false
                    );

                    this.handleAppMessage(socket, auth, body, phone, controller.signal, platform);

                    return this.socket.handleCallBack(
                        callback,
                        200,
                        true,
                        "Message received successfully.",
                        null
                    );
                }

                case "Whatsapp":
                {
                    const result = await this.validation.validateWhatsappMessage(body, session);

                    if(!result.success)
                    {
                        return this.socket.handleCallBack(
                            callback,
                            result.statusCode,
                            false,
                            result.message,
                            result.data
                        );
                    }

                    if(session.processing.whatsapp)
                    {
                        return this.socket.handleCallBack(
                            callback,
                            429,
                            false,
                            "Already processing a message.",
                            null
                        );
                    }

                    const saved = await this.database.saveMessage(
                        this.session,
                        phone,
                        platform,
                        session.webName,
                        {
                            role: "user",
                            content: body.content ?? "",
                            urls: body.urls ?? [],
                            jobIds: body.jobIds ?? [],
                            files: body.files ?? null,
                            instructionData: null,
                            isServer: false,
                            metadata: body.metadata ?? null,
                            promptCosts: null,
                            cancelled: false,
                            cleanContent: null,
                            whatsappMessageId: body.whatsappMessageId ?? null,
                            whatsappRawPayload: body.whatsappRawPayload ?? null
                        }
                    );

                    if(!saved.success)
                    {
                        return this.socket.handleCallBack(
                            callback,
                            500,
                            false,
                            "Failed to save message.",
                            null
                        );
                    }
                    
                    body._userMessageId = saved.data?.id ?? null;
                    const controller = new AbortController();
                    this.activeControllers.set(phone, controller);

                    await this.socket.forward(
                        phone, 
                        "onWhatsappChunk", 
                        { 
                            role: "assistant", 
                            chunk: "Analysing...",
                            new: true 
                        }, 
                        true, 
                        false
                    );

                    await this.socket.forward(
                        phone, 
                        "onWhatsappProcessing", 
                        { 
                            processing: true,
                            file: false 
                        }, 
                        false, 
                        false
                    );

                    //session.processing.whatsapp = true;
                    //await this.session.updateSession(phone, session);

                    this.handleWhatsappMessage(auth, body, phone, controller.signal, platform);

                    return this.socket.handleCallBack(
                        callback,
                        200,
                        true,
                        "Message received successfully.",
                        null
                    );
                }

                default:
                {
                    return this.socket.handleCallBack(
                        callback,
                        400,
                        false,
                        "Invalid or missing platform.",
                        null
                    );
                }
            }
        }
        catch(error)
        {
            console.error("❌ message failed:", error.message);

            this.socket.handleCallBack(
                callback,
                500,
                false,
                "Internal error.",
                null
            );
        }
    }

    async handleAppMessage(socket, auth, body, phone, signal, platform)
    {
        try
        {
            const session = await this.session.getSession(phone);
            if(!session)
            {
                return await this.socket.forward(
                    phone,
                    "onError",
                    {
                        statusCode: 404,
                        success: false,
                        message: "Session not found.",
                        data: null
                    },
                    false,
                    true
                );
            }

            const activePrompt = session.activePrompt ?? "conversation";
            const specialist = this.specialists[activePrompt];

            if(!specialist)
            {
                return await this.socket.forward(
                    phone, 
                    "onError", 
                    { 
                        statusCode: 500, 
                        success: false, 
                        message: "Unknown specialist.", 
                        data: null 
                    }, 
                    false, 
                    true
                );
            }

            await specialist.resolve(this, session.iteration ?? 1, phone, platform, session, body, signal);
        }
        catch(error)
        {
            console.error("Error occured handling Wira app message: ", error);

            return await this.socket.forward(
                phone,
                "onError",
                {
                    statusCode: 500,
                    success: false,
                    message: "Error occured in handle app message.",
                    data: null
                },
                false,
                true
            );
        }
        finally
        {
            this.activeControllers.delete(phone);
            await this.finallyHandler(phone, platform, body, signal);
        }
    }

    async handleWhatsappMessage(auth, body, phone, signal, platform)
    {
        try
        {
            const session = await this.session.getSession(phone);
            if(!session)
            {
                await this.whatsapp.sendError(
                    phone, 
                    "Session not found.", 
                    null
                );

                return;
            }

            const activePrompt = session.activePrompt ?? "conversation";
            const specialist = this.specialists[activePrompt];

            if(!specialist)
            {
                await this.whatsapp.sendError(
                    phone, 
                    "Unknown specialist.", 
                    null
                );

                return;
            }

            await specialist.resolve(this, session.iteration ?? 1, phone, platform, session, body, signal);
        }
        catch(error)
        {
            console.error("Error occured handling Wira whatsapp message: ", error);

            await this.whatsapp.sendError(
                phone, 
                "Internal error.", 
                null
            );

            return;
        }
        finally
        {
            this.activeControllers.delete(phone);
            await this.finallyHandler(phone, platform, body, signal);
        }
    }

    async getRecentMessages(phone, platform, session, currentContent = "", currentFiles = [], currentJobIds = null)
    {
        const isWhatsapp = platform === "Whatsapp";
        const conversationKey = isWhatsapp ? "whatsappConversation" : "appConversation";
        const fetchPlatform = isWhatsapp ? "Whatsapp" : "App";
        let messages = session[conversationKey] ?? [];

        if(messages.length < 4)
        {
            const result = await this.database.fetchLastMessages(phone, fetchPlatform, 5);

            if(result.success && result.data.messages.length > 0)
            {
                messages = result.data.messages;
                session[conversationKey] = messages;
                await this.session.updateSession(phone, session);
            }
        }

        const statefulSpecialists = ["profile", "examiner", "screening"];
        const suppressMetadataKeys = statefulSpecialists.filter(key =>
        {
            const val = session.sessionMetadata?.[key];
            return val !== null && val !== undefined && val !== "";
        });

        const recentFour = messages.slice(-5, -1);
        const formattedMessages = recentFour.map(m => 
            this.utility.formatMessageForConversation(m.role, m, suppressMetadataKeys)
        ).filter(Boolean);

        const routerMessages = [
            ...recentFour.map(m => this.utility.formatRouterMessage(m.role, m.content, m.files, m.jobIds)),
            this.utility.formatRouterMessage("user", currentContent, currentFiles, currentJobIds)
        ].filter(Boolean);

        console.log("Recent Messages Output: ", {
            messages: recentFour,
            formatted: formattedMessages,
            router: routerMessages
        });

        return {
            messages: recentFour,
            formatted: formattedMessages,
            router: routerMessages
        };
    }

    async initialPrepareContent(phone, platform, session, body, signal)
    {
        try
        {
            const currentContent = body.content ?? "";
            const currentJobIds = body.jobIds ?? null;
            const activePrompt = session.activePrompt ?? "conversation";
            let currentFiles = body.files ?? [];

            const { messages, formatted, router } = await this.getRecentMessages(
                phone,
                platform,
                session,
                currentContent,
                currentFiles,
                currentJobIds
            );

            if(currentFiles.length > 0)
            {
                if(!signal?.aborted)
                {
                    const fileResult = await this.retrieve.fetchFileData(currentFiles);
                    if(fileResult.success)
                    {
                        currentFiles = fileResult.data.files;
                    }
                }
            }

            if(signal?.aborted)
            {
                return {
                    statusCode: 499,
                    success: false,
                    message: "Aborted.",
                    data: null
                };
            }

            if(activePrompt !== "conversation")
            {
                const contextParts = {};
                const currentMessageParts = [];

                if(activePrompt === "resume")
                {
                    const candidateResult = await this.retrieve.fetchCandidate(phone);
                    const candidateData = candidateResult.success ? candidateResult.data : session.user;

                    if(candidateData)
                    {
                        contextParts.candidateProfile = candidateData;
                    }
                }
                else if(activePrompt === "profile")
                {
                    const existingMetadata = session.sessionMetadata?.profile;
                    const hasMetadata = existingMetadata !== null && existingMetadata !== undefined && existingMetadata !== "";

                    if(hasMetadata)
                    {
                        contextParts.candidateProfile = existingMetadata;
                    }
                    else
                    {
                        const candidateResult = await this.retrieve.fetchCandidate(phone);
                        const candidateData = candidateResult.success ? candidateResult.data : session.user;

                        if(candidateData)
                        {
                            contextParts.candidateProfile = candidateData;
                        }
                    }
                }
                else if(activePrompt === "examiner")
                {
                    const existingMetadata = session.sessionMetadata?.examiner;
                    const hasMetadata = existingMetadata !== null && existingMetadata !== undefined && existingMetadata !== "";

                    if(hasMetadata)
                    {
                        contextParts.sessionMetadata = existingMetadata;
                    }
                }
                else if(activePrompt === "screening")
                {
                    const existingMetadata = session.sessionMetadata?.screening;
                    const hasMetadata = existingMetadata !== null && existingMetadata !== undefined && existingMetadata !== "";

                    if(hasMetadata)
                    {
                        contextParts.sessionMetadata = existingMetadata;
                    }
                }

                if(body.metadata && Object.keys(body.metadata).length > 0)
                {
                    contextParts.metadata = body.metadata;
                }

                if(currentJobIds && currentJobIds.length > 0)
                {
                    contextParts.jobIds = currentJobIds;
                }

                if(signal?.aborted)
                {
                    return {
                        statusCode: 499,
                        success: false,
                        message: "Aborted.",
                        data: null
                    };
                }

                if(currentContent && currentContent.trim().length > 0)
                {
                    currentMessageParts.push(`Message: ${currentContent}`);
                }

                if(Object.keys(contextParts).length > 0)
                {
                    currentMessageParts.push(`Metadata: ${JSON.stringify(contextParts)}`);
                }

                const conversation = [...formatted];
                const filesWithTranscript = currentFiles.filter(f => f.transcript !== null && f.transcript !== undefined);

                if(filesWithTranscript.length > 0)
                {
                    currentMessageParts.push(`Files: ${JSON.stringify(filesWithTranscript)}`);
                }

                conversation.push({
                    role: "user",
                    content: currentMessageParts.join("\n")
                });

                return {
                    statusCode: 200,
                    success: true,
                    message: "Content prepared successfully.",
                    data: {
                        conversation: conversation,
                        files: currentFiles
                    }
                };
            }

            const routerOutput = await this.AI.router(activePrompt, router, signal, phone);
            if(routerOutput.aborted)
            {
                return {
                    statusCode: 499,
                    success: false,
                    message: "Aborted.",
                    data: null
                };
            }

            console.log("Router output: ", routerOutput);

            const excludeIds = messages.map(m => m.id);
            const excludeFileNames = currentFiles.map(f => f.fileName).filter(Boolean);

            let semanticPast = "";
            let businessInfo = "";
            let semanticFiles = "";
            let lastOutput = null;

            const prerequisiteTasks = [];
            if(routerOutput.prerequisites.includes("getSemantic"))
            {
                if(!signal?.aborted)
                {
                    prerequisiteTasks.push(
                        this.prerequisites.getSemantic.resolve(this, phone, platform, semanticQuery, excludeIds, excludeFileNames).then(result =>
                        {
                            semanticPast = result.semanticPast;
                            businessInfo = result.businessInfo;
                            semanticFiles = result.semanticFiles;
                        }
                    ));
                }
            }
            else
            {
                if(routerOutput.prerequisites.includes("getSemanticPast"))
                {
                    if(!signal?.aborted)
                    {
                        prerequisiteTasks.push(this.prerequisites.getSemanticPast.resolve(this, phone, platform, semanticQuery, excludeIds).then(result => { semanticPast = result.formatted; }));
                    }
                }

                if(routerOutput.prerequisites.includes("getBusinessInfo"))
                {
                    if(!signal?.aborted)
                    {
                        prerequisiteTasks.push(this.prerequisites.getBusinessInfo.resolve(this, semanticQuery).then(result => { businessInfo = result.formatted; }));
                    }
                }

                if(routerOutput.prerequisites.includes("getSemanticFiles"))
                {
                    if(!signal?.aborted)
                    {
                        prerequisiteTasks.push(this.prerequisites.getSemanticFiles.resolve(this, phone, semanticQuery, excludeFileNames).then(result => { semanticFiles = result.formatted; }));
                    }
                }

                if(routerOutput.prerequisites.includes("getLastOutput"))
                {
                    if(!signal?.aborted)
                    {
                        prerequisiteTasks.push(this.prerequisites.getLastOutput.resolve(this, phone).then(result => { lastOutput = result; }));
                    }
                }

                await Promise.all(prerequisiteTasks);

                if(signal?.aborted)
                {
                    return {
                        statusCode: 499,
                        success: false,
                        message: "Aborted.",
                        data: null
                    };
                }
            }

            console.log("Semantic past: ", semanticPast);
            console.log("Business info: ", businessInfo);
            console.log("Last output: ", lastOutput);
            console.log("Semantic files: ", semanticFiles);

            const conversation = [];

            if(semanticPast && semanticPast.length > 0)
            {
                conversation.push({
                    role: "user",
                    content: `Semantic Past: ${semanticPast}`
                });
            }

            if(semanticFiles && semanticFiles.length > 0)
            {
                conversation.push({
                    role: "user",
                    content: `Semantic files transcript: ${JSON.stringify(semanticFiles)}`
                });
            }

            conversation.push(...formatted);
            const contextParts = {};

            if(prompts && prompts.length > 0 && activePrompt === "conversation")
            {
                contextParts.skills = prompts;
            }

            if(lastOutput)
            {
                contextParts.lastOutput = lastOutput;
            }

            if(businessInfo && businessInfo.length > 0)
            {
                contextParts.businessInfo = businessInfo;
            }

            const filesWithTranscript = currentFiles.filter(f => f.transcript !== null && f.transcript !== undefined);
            if(filesWithTranscript.length > 0)
            {
                contextParts.files = filesWithTranscript;
            }

            if(body.metadata && Object.keys(body.metadata).length > 0)
            {
                contextParts.metadata = body.metadata;
            }

            if(currentJobIds && currentJobIds.length > 0)
            {
                contextParts.jobIds = currentJobIds;
            }

            const currentMessageParts = [];
            if(currentContent && currentContent.trim().length > 0)
            {
                currentMessageParts.push(`Message: ${currentContent}`);
            }

            if(Object.keys(contextParts).length > 0)
            {
                currentMessageParts.push(`Metadata: ${JSON.stringify(contextParts)}`);
            }

            const activePromptMetadata = session.sessionMetadata?.[activePrompt];
            if(activePromptMetadata !== null && activePromptMetadata !== undefined && activePromptMetadata !== "")
            {
                contextParts.sessionMetadata = activePromptMetadata;
            }

            conversation.push({
                role: "user",
                content: currentMessageParts.join("\n")
            });

            return {
                statusCode: 200,
                success: true,
                message: "Content prepared successfully.",
                data: {
                    conversation: conversation,
                    files: currentFiles
                }
            };
        }
        catch(error)
        {
            console.error("Error occured preparing Wira content: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error.",
                data: null
            };
        }
    }

    async executeAI(phone, conversation, files, signal, platform)
    {
        try
        {
            const session = await this.session.getSession(phone);

            if(!session)
            {
                return {
                    output: null,
                    aborted: false,
                    error: true
                };
            }

            const activePrompt = session.activePrompt ?? "conversation";
            console.log(`🎯 executeAI activePrompt: ${activePrompt}, iteration: ${session.iteration}`);
            if(typeof this.AI[activePrompt] !== "function")
            {
                console.error(`❌ executeAI: no function found on WiraGemini for prompt: ${activePrompt}`);

                return {
                    output: null,
                    aborted: false,
                    error: true
                };
            }

            let accumulated = "";
            let processingParsed = false;
            let contentStarted = false;
            let contentFinished = false;
            let isFirstChunk = true;

            const isWhatsapp = platform === "Whatsapp";
            const processingEvent = isWhatsapp ? "onWhatsappProcessing" : "onProcessing";
            const chunkEvent = isWhatsapp ? "onWhatsappChunk" : "onChunk";

            const sessionForFile = await this.session.getSession(phone);
            const fileInProgress = sessionForFile?.fileInProgress ?? false;

            const onChunk = (chunk) =>
            {
                if(!contentStarted)
                {
                    accumulated += chunk;
                }

                if(!processingParsed)
                {
                    const match = accumulated.match(/"processing"\s*:\s*(true|false)/);

                    if(match)
                    {
                        this.socket.forward(
                            phone, 
                            processingEvent, 
                            { 
                                processing: true,
                                file: fileInProgress
                            }, 
                            false, 
                            false
                        );

                        processingParsed = true;
                    }
                }

                if(processingParsed && !contentFinished)
                {
                    if(!contentStarted)
                    {
                        const startMatch = accumulated.match(/"content"\s*:\s*"/);

                        if(startMatch)
                        {
                            contentStarted = true;
                            accumulated = accumulated.slice(startMatch.index + startMatch[0].length);

                            let i = 0;
                            let token = "";

                            while(i < accumulated.length)
                            {
                                const char = accumulated[i];

                                if(char === "\\" && i + 1 < accumulated.length)
                                {
                                    const next = accumulated[i + 1];

                                    if(next === "n")
                                    {
                                        token += "\n";
                                        i += 2;
                                        continue;
                                    }

                                    if(next === '"')
                                    {
                                        token += '"';
                                        i += 2;
                                        continue;
                                    }

                                    if(next === "\\")
                                    {
                                        token += "\\";
                                        i += 2;
                                        continue;
                                    }

                                    token += next;
                                    i += 2;
                                    continue;
                                }

                                if(char === '"')
                                {
                                    contentFinished = true;

                                    if(token.length > 0)
                                    {
                                        this.socket.forward(
                                            phone, 
                                            chunkEvent, 
                                            { 
                                                role: "assistant",
                                                chunk: token,
                                                new: isFirstChunk
                                            }, 
                                            false, 
                                            false
                                        );

                                        isFirstChunk = false;
                                    }

                                    break;
                                }

                                token += char;
                                i++;
                            }

                            if(!contentFinished && token.length > 0)
                            {
                                this.socket.forward(
                                    phone, 
                                    chunkEvent, 
                                    { 
                                        role: "assistant",
                                        chunk: token,
                                        new: isFirstChunk
                                    }, 
                                    false, 
                                    false
                                );

                                isFirstChunk = false;
                            }

                            accumulated = "";
                        }
                    }
                    else
                    {
                        let i = 0;
                        let token = "";

                        while(i < chunk.length)
                        {
                            const char = chunk[i];

                            if(char === "\\" && i + 1 < chunk.length)
                            {
                                const next = chunk[i + 1];

                                if(next === "n")
                                {
                                    token += "\n";
                                    i += 2;
                                    continue;
                                }

                                if(next === '"')
                                {
                                    token += '"';
                                    i += 2;
                                    continue;
                                }

                                if(next === "\\")
                                {
                                    token += "\\";
                                    i += 2;
                                    continue;
                                }

                                token += next;
                                i += 2;
                                continue;
                            }

                            if(char === '"')
                            {
                                contentFinished = true;

                                if(token.length > 0)
                                {
                                    this.socket.forward(
                                        phone, 
                                        chunkEvent, 
                                        { 
                                            role: "assistant",
                                            chunk: token,
                                            new: isFirstChunk 
                                        }, 
                                        false, 
                                        false
                                    );

                                    isFirstChunk = false;
                                }

                                break;
                            }

                            token += char;
                            i++;
                        }

                        if(!contentFinished && token.length > 0)
                        {
                            this.socket.forward(
                                phone, 
                                chunkEvent, 
                                { 
                                    role: "assistant",
                                    chunk: token,
                                    new: isFirstChunk 
                                }, 
                                false, 
                                false
                            );

                            isFirstChunk = false;
                        }
                    }
                }
            };

            const iteration = session.iteration ?? 1;
            conversation[conversation.length - 1].content += `\nIteration: ${iteration}`;

            const aiResult = await this.AI[activePrompt](
                phone,
                conversation,
                files,
                onChunk,
                signal
            );

            if(aiResult.aborted)
            {
                return {
                    output: null,
                    aborted: true,
                    error: false
                };
            }

            if(!aiResult.output)
            {
                return {
                    output: null,
                    aborted: false,
                    error: true
                };
            }

            const output = aiResult.output;
            const forwardTo = output.instruction?.forwardTo ?? null;
            const currentSession = await this.session.getSession(phone);

            if(!currentSession)
            {
                return {
                    output: null,
                    aborted: false,
                    error: true
                };
            }

            if(forwardTo === "abort")
            {
                currentSession.activePrompt = "conversation";

                if(currentSession.sessionMetadata?.[activePrompt] !== null && currentSession.sessionMetadata?.[activePrompt] !== undefined && currentSession.sessionMetadata?.[activePrompt] !== "")
                {
                    currentSession.sessionMetadata[activePrompt] = null;
                }
            }
            else if(forwardTo === "revert")
            {
                currentSession.activePrompt = "conversation";
            }
            else if(forwardTo)
            {
                currentSession.activePrompt = forwardTo;
            }

            if(output.metadata && typeof output.metadata === "object")
            {
                const specialistKeys = Object.keys(this.AI.prompts.getSpecialistRoutes());
                for(const key of specialistKeys)
                {
                    if(key === "conversation")
                    {
                        continue;
                    }

                    if(output.metadata[key] !== null && output.metadata[key] !== undefined && output.metadata[key] !== "")
                    {
                        if(!currentSession.sessionMetadata)
                        {
                            currentSession.sessionMetadata = {};
                        }

                        if(typeof output.metadata[key] === "object" && !Array.isArray(output.metadata[key]) && typeof currentSession.sessionMetadata[key] === "object" && currentSession.sessionMetadata[key] !== null)
                        {
                            currentSession.sessionMetadata[key] = {
                                ...currentSession.sessionMetadata[key],
                                ...output.metadata[key]
                            };
                        }
                        else
                        {
                            currentSession.sessionMetadata[key] = output.metadata[key];
                        }
                    }
                }
            }

            await this.session.updateSession(phone, currentSession);

            return {
                output,
                aborted: false,
                error: false
            };
        }
        catch(error)
        {
            console.error("❌ executeAI failed:", error);

            return {
                output: null,
                aborted: false,
                error: true
            };
        }
    }

    async executeInstructions(phone, instructions, aiMetadata, forwardInfo)
    {
        try
        {
            const commandMap = {};

            for(const [key, skill] of Object.entries(this.retrieveSkills))
            {
                commandMap[skill.command] = skill;
            }

            for(const [key, skill] of Object.entries(this.performSkills))
            {
                commandMap[skill.command] = skill;
            }

            const tasks = instructions.map(async (instruction) =>
            {
                const command = instruction.command;
                const instructionData = instruction.instructionData ?? {};
                const skill = commandMap[command];

                if(!skill)
                {
                    console.warn(`Unknown instruction command: ${command}`);

                    return {
                        command: command,
                        instructionData: instructionData,
                        statusCode: 400,
                        success: false,
                        message: "Unknown command.",
                        jobs: null,
                        files: null,
                        data: null
                    };
                }

                try
                {
                    const result = await skill.resolve(this, phone, instructionData);

                    return {
                        command: command,
                        instructionData: instructionData,
                        statusCode: result.output?.statusCode ?? 500,
                        success: result.output?.success ?? false,
                        message: result.output?.message ?? null,
                        jobs: result.jobs ?? null,
                        files: result.files ?? null,
                        data: result.output?.data ?? null
                    };
                }
                catch(error)
                {
                    console.error(`executeInstructions: skill ${command} threw:`, error.message);

                    return {
                        command: command,
                        instructionData: instructionData,
                        statusCode: 500,
                        success: false,
                        message: "Skill execution failed.",
                        jobs: null,
                        files: null,
                        data: null
                    };
                }
            });

            const results = await Promise.all(tasks);
            const currentSession = await this.session.getSession(phone);

            if(!currentSession)
            {
                return {
                    statusCode: 404,
                    success: false,
                    message: "Session not found.",
                    data: null
                };
            }

            const wishlistIds = currentSession.wishlistIds ?? [];
            const appliedJobIds = currentSession.appliedJobIds ?? [];

            if(!currentSession.turnNotebook || typeof currentSession.turnNotebook !== "object")
            {
                currentSession.turnNotebook = {
                    costs: [],
                    lastOutput: []
                };
            }

            if(!Array.isArray(currentSession.turnNotebook.lastOutput))
            {
                currentSession.turnNotebook.lastOutput = [];
            }

            const iterationOutput = [];
            const iterationJobs = [];
            const iterationFiles = [];
            const jobIdSet = new Set();
            const fileNameSet = new Set();

            for(const r of results)
            {
                const formattedData = {};

                if(r.data !== null && r.data !== undefined)
                {
                    if(r.jobs && Array.isArray(r.jobs) && r.jobs.length > 0)
                    {
                        const formatted = this.utility.formatLastOutputForAI(r.jobs, wishlistIds, appliedJobIds);
                        formattedData.jobs = formatted;

                        for(const job of r.jobs)
                        {
                            if(!jobIdSet.has(job.id))
                            {
                                jobIdSet.add(job.id);
                                iterationJobs.push(job);
                            }
                        }
                    }
                    else
                    {
                        for(const [key, value] of Object.entries(r.data))
                        {
                            formattedData[key] = value;
                        }
                    }

                    if(r.files && Array.isArray(r.files) && r.files.length > 0)
                    {
                        formattedData.files = r.files;

                        for(const file of r.files)
                        {
                            if(!fileNameSet.has(file.fileName))
                            {
                                fileNameSet.add(file.fileName);
                                iterationFiles.push(file);
                            }
                        }
                    }
                }

                iterationOutput.push({
                    command: r.command,
                    instructionData: r.instructionData ?? null,
                    statusCode: r.statusCode,
                    success: r.success,
                    message: r.message,
                    data: Object.keys(formattedData).length > 0 ? formattedData : null
                });
            }

            const currentIteration = currentSession.iteration ?? 1;
            const iterationJobIds = iterationJobs.length > 0 ? this.utility.formatLastOutputForAI(iterationJobs, wishlistIds, appliedJobIds).map(j =>
            {
                const entry = { 
                    id: j.id 
                };

                if(j.positionName !== undefined && j.positionName !== null)
                {
                    entry.positionName = j.positionName;
                }

                if(j.location !== undefined && j.location !== null)
                {
                    entry.location = j.location;
                }

                if(j.industry !== undefined && j.industry !== null)
                {
                    entry.industry = j.industry;
                }

                if(j.isWishlisted !== undefined && j.isWishlisted !== null)
                {
                    entry.isWishlisted = j.isWishlisted;
                }

                if(j.isApplied !== undefined && j.isApplied !== null)
                {
                    entry.isApplied = j.isApplied;
                }

                if(j.similarity !== undefined && j.similarity !== null)
                {
                    entry.similarity = j.similarity;
                }

                if(j.status !== undefined && j.status !== null)
                {
                    entry.status = j.status;
                }

                return entry;
            })
            : null;

            const iterationEntry =
            {
                iteration: currentIteration,
                rawMetadata: aiMetadata ?? null,
                jobs: iterationJobs.length > 0 ? iterationJobs : null,
                jobIds: iterationJobIds,
                files: iterationFiles.length > 0 ? iterationFiles : null,
                output: iterationOutput,
                forwardInfo: forwardInfo ?? null
            };

            currentSession.turnNotebook.lastOutput.push(iterationEntry);
            const existingSessionLastOutput = Array.isArray(currentSession.lastOutput) ? currentSession.lastOutput : [];

            for(const entry of iterationOutput)
            {
                existingSessionLastOutput.push(entry);
            }

            currentSession.lastOutput = existingSessionLastOutput;
            await this.session.updateSession(phone, currentSession);

            return {
                statusCode: 200,
                success: true,
                message: "Instructions executed.",
                data: iterationEntry
            };
        }
        catch(error)
        {
            console.error("Error occured executing instructions: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error.",
                data: null
            };
        }
    }

    async processOutput(phone, output, signal, platform, accumulator = null)
    {
        try
        {
            if(signal?.aborted)
            {
                return null;
            }

            if(!accumulator)
            {
                accumulator = {
                    cleanUserContent: null,
                    urls: [],
                    files: [],
                    metadata: {},
                    outputArray: [],
                    instructionData: [],
                    isFirstIteration: true
                };
            }

            const forwardTo = output.forwardTo ?? output.instruction?.forwardTo ?? null;
            const instructions = output.instructions ?? output.instruction?.instructions ?? [];
            const forwardInfo = output.forwardInfo ?? output.instruction?.forwardInfo ?? null;

            if(accumulator.isFirstIteration)
            {
                accumulator.cleanUserContent = output.cleanUserContent ?? null;
                accumulator.urls = output.urls ?? [];
                accumulator.isFirstIteration = false;
            }

            if(output.metadata && typeof output.metadata === "object")
            {
                accumulator.metadata = {
                    ...accumulator.metadata,
                    ...output.metadata
                };
            }

            const currentSession = await this.session.getSession(phone);
            if(!currentSession)
            {
                return null;
            }

            let instructionResult = null;
            if(instructions.length > 0)
            {
                instructionResult = await this.executeInstructions(phone, currentSession, instructions, output);
            }

            const iterationMetadata = instructionResult?.data?.iterationMetadata ?? null;

            if(iterationMetadata?.output && Array.isArray(iterationMetadata.output))
            {
                accumulator.outputArray.push(...iterationMetadata.output);
            }

            const jobIds = instructionResult?.data?.jobIds ?? null;
            const results = instructionResult?.data?.results ?? [];

            const iterationInstructionData = {
                forwardTo: forwardTo,
                forwardInfo: forwardInfo,
                instructions: instructions.map(inst =>
                {
                    const match = results.find(r => r.command === inst.command);
                    const entry = {
                        command: inst.command,
                        success: match?.success ?? false,
                        message: match?.message ?? null
                    };
                    if(inst.instructionData !== null && inst.instructionData !== undefined)
                    {
                        entry.instructionData = inst.instructionData;
                    }
                    return entry;
                })
            };

            accumulator.instructionData.push(iterationInstructionData);

            console.log("processOutput terminal:", { 
                forwardTo: forwardTo, 
                instructions: instructions.length, 
                instructionResult: JSON.stringify(instructionResult?.data) 
            });

            if(!forwardTo || forwardTo === "revert" || forwardTo === "abort")
            {
                let cleanJobIds = null;
                if(jobIds && Array.isArray(jobIds) && jobIds.length > 0)
                {
                    cleanJobIds = jobIds.map(j =>
                    {
                        const entry = { 
                            id: j.id 
                        };

                        if(j.positionName !== undefined && j.positionName !== null)
                        {
                            entry.positionName = j.positionName;
                        }

                        if(j.location !== undefined && j.location !== null)
                        {
                            entry.location = j.location;
                        }

                        if(j.industry !== undefined && j.industry !== null)
                        {
                            entry.industry = j.industry;
                        }

                        if(j.isWishlisted !== undefined && j.isWishlisted !== null)
                        {
                            entry.isWishlisted = j.isWishlisted;
                        }
                        
                        if(j.isApplied !== undefined && j.isApplied !== null)
                        {
                            entry.isApplied = j.isApplied;
                        }
                        
                        if(j.similarity !== undefined && j.similarity !== null)
                        {
                            entry.similarity = j.similarity;
                        }
                        
                        if(j.status !== undefined && j.status !== null)
                        {
                            entry.status = j.status;
                        }
                        
                        return entry;
                    });
                }

                const specialistMetadata = Object.keys(accumulator.metadata).length > 0 ? accumulator.metadata : null;
                const outputArray = accumulator.outputArray.length > 0 ? accumulator.outputArray : null;

                const finalMetadata = {
                    ...(specialistMetadata ?? {}),
                    ...(outputArray ? { output: outputArray } : {})
                };

                const hasMetadata = Object.keys(finalMetadata).length > 0;
                const payloadOutput = {...output};
                
                if(hasMetadata)
                {
                    payloadOutput.metadata = finalMetadata;
                }

                if(cleanJobIds)
                {
                    payloadOutput.jobIds = cleanJobIds;
                }
                
                return {
                    payload: {
                        role: "assistant",
                        processing: false,
                        ...payloadOutput
                    },
                    cleanUserContent: accumulator.cleanUserContent,
                    urls: accumulator.urls,
                    files: accumulator.files,
                    dbMetadata: hasMetadata ? finalMetadata : null,
                    instructionData: accumulator.instructionData
                };
            }

            if(signal?.aborted)
            {
                return null;
            }

            const freshSession = await this.session.getSession(phone);
            if(!freshSession)
            {
                return null;
            }

            const activePrompt = freshSession.activePrompt ?? "conversation";
            const wishlistIds = freshSession.wishlistIds ?? [];
            const appliedJobIds = freshSession.appliedJobIds ?? [];
            const turnNotebook = freshSession.turnNotebook ?? {};
            const iterations = turnNotebook.iterations ?? {};

            const formattedIterations = {};
            for(const [key, iter] of Object.entries(iterations))
            {
                if(!iter || !iter.metadata || !Array.isArray(iter.metadata.output))
                {
                    formattedIterations[key] = iter;
                    continue;
                }

                formattedIterations[key] = {
                    ...iter,
                    metadata: {
                        ...iter.metadata,
                        output: iter.metadata.output.map(r =>
                        {
                            if(!r.data || !Array.isArray(r.data.jobs) || r.data.jobs.length === 0)
                            {
                                return r;
                            }

                            return {
                                ...r,
                                data: {
                                    ...r.data,
                                    jobs: this.utility.formatLastOutputForAI(r.data.jobs, wishlistIds, appliedJobIds)
                                }
                            };
                        })
                    }
                };
            }

            const conversation = [];
            if(forwardInfo)
            {
                conversation.push({
                    role: "user",
                    content: `forwardInfo: ${forwardInfo}`
                });
            }

            const sessionMetadataValue = freshSession.sessionMetadata?.[activePrompt];
            if(sessionMetadataValue !== null && sessionMetadataValue !== undefined && sessionMetadataValue !== "")
            {
                conversation.push({
                    role: "user",
                    content: `sessionMetadata: ${JSON.stringify(sessionMetadataValue)}`
                });
            }

            if(Object.keys(formattedIterations).length > 0)
            {
                conversation.push({
                    role: "user",
                    content: `Output: ${JSON.stringify(formattedIterations)}`
                });
            }

            const aiResult = await this.executeAI(phone, conversation, [], signal, platform);
            if(aiResult.aborted || aiResult.error || !aiResult.output)
            {
                return null;
            }

            console.log("Conversation App output (chained): ", JSON.stringify(aiResult.output));
            return await this.processOutput(phone, aiResult.output, signal, platform, accumulator);
        }
        catch(error)
        {
            console.error("Error occured in processOutput: ", error);
            return null;
        }
    }

    async conversationHandler(manager, iteration, phone, platform, session, body, signal)
    {
        try
        {
            if(signal?.aborted)
            {
                return null;
            }

            const isWhatsapp = platform === "Whatsapp";

            let conversation = [];
            let currentFiles = [];

            if(iteration === 1)
            {
                const currentContent = body.content ?? "";
                const currentJobIds = body.jobIds ?? null;
                currentFiles = body.files ?? [];

                const { messages, formatted, router } = await manager.getRecentMessages(
                    phone,
                    platform,
                    session,
                    currentContent,
                    currentFiles,
                    currentJobIds
                );

                if(currentFiles.length > 0 && !signal?.aborted)
                {
                    const fileResult = await manager.retrieve.fetchFileData(currentFiles);
                    if(fileResult.success)
                    {
                        currentFiles = fileResult.data.files;
                    }
                }

                if(signal?.aborted)
                {
                    return null;
                }

                const routerOutput = await manager.AI.router("conversation", router, signal, phone);
                if(routerOutput.aborted)
                {
                    return null;
                }

                console.log("Router output: ", JSON.stringify(routerOutput, null, 2));

                const excludeIds = messages.map(m => m.id);
                const excludeFileNames = currentFiles.map(f => f.fileName).filter(Boolean);

                let semanticPast = "";
                let businessInfo = "";
                let semanticFiles = "";
                let lastOutput = null;

                const prerequisiteTasks = [];

                if(routerOutput.prerequisites.includes("getSemantic"))
                {
                    if(!signal?.aborted)
                    {
                        prerequisiteTasks.push(manager.prerequisites.getSemantic.resolve(manager, phone, platform, currentContent, excludeIds, excludeFileNames).then(result =>
                            {
                                semanticPast = result.semanticPast;
                                businessInfo = result.businessInfo;
                                semanticFiles = result.semanticFiles;
                            }
                        ));
                    }
                }
                else
                {
                    if(routerOutput.prerequisites.includes("getSemanticPast") && !signal?.aborted)
                    {
                        prerequisiteTasks.push(manager.prerequisites.getSemanticPast.resolve(manager, phone, platform, currentContent, excludeIds).then(result =>
                            {
                                semanticPast = result.formatted;
                            }
                        ));
                    }

                    if(routerOutput.prerequisites.includes("getBusinessInfo") && !signal?.aborted)
                    {
                        prerequisiteTasks.push(manager.prerequisites.getBusinessInfo.resolve(manager, currentContent).then(result =>
                            {
                                businessInfo = result.formatted;
                            }
                        ));
                    }

                    if(routerOutput.prerequisites.includes("getSemanticFiles") && !signal?.aborted)
                    {
                        prerequisiteTasks.push(manager.prerequisites.getSemanticFiles.resolve(manager, phone, currentContent, excludeFileNames).then(result =>
                            {
                                semanticFiles = result.formatted;
                            }
                        ));
                    }

                    if(routerOutput.prerequisites.includes("getLastOutput") && !signal?.aborted)
                    {
                        prerequisiteTasks.push(manager.prerequisites.getLastOutput.resolve(manager, phone).then(result =>
                            {
                                lastOutput = result;
                            }
                        ));
                    }
                }

                await Promise.all(prerequisiteTasks);

                if(signal?.aborted)
                {
                    return null;
                }

                if(semanticPast && semanticPast.length > 0)
                {
                    conversation.push({
                        role: "user",
                        content: `Semantic Past: ${semanticPast}`
                    });
                }

                if(semanticFiles && semanticFiles.length > 0)
                {
                    conversation.push({
                        role: "user",
                        content: `Semantic files transcript: ${JSON.stringify(semanticFiles)}`
                    });
                }

                conversation.push(...formatted);
                const contextParts = {};

                if(routerOutput.prompts && routerOutput.prompts.length > 0)
                {
                    contextParts.skills = routerOutput.prompts;
                }

                if(lastOutput)
                {
                    contextParts.lastOutput = lastOutput;
                }

                if(businessInfo && businessInfo.length > 0)
                {
                    contextParts.businessInfo = businessInfo;
                }

                const filesWithTranscript = currentFiles.filter(f => f.transcript !== null && f.transcript !== undefined);
                if(filesWithTranscript.length > 0)
                {
                    contextParts.files = filesWithTranscript;
                }

                if(body.metadata && Object.keys(body.metadata).length > 0)
                {
                    contextParts.metadata = body.metadata;
                }

                if(currentJobIds && currentJobIds.length > 0)
                {
                    contextParts.jobIds = currentJobIds;
                }

                const currentMessageParts = [];

                if(currentContent && currentContent.trim().length > 0)
                {
                    currentMessageParts.push(`Message: ${currentContent}`);
                }

                if(Object.keys(contextParts).length > 0)
                {
                    currentMessageParts.push(`Metadata: ${JSON.stringify(contextParts)}`);
                }   

                currentMessageParts.push(`Iteration: ${iteration}`);

                conversation.push({
                    role: "user",
                    content: currentMessageParts.join("\n")
                });
            }
            else
            {
                const currentSession = await manager.session.getSession(phone);

                if(!currentSession)
                {
                    return null;
                }

                const turnNotebook = currentSession.turnNotebook ?? {};
                const lastIteration = turnNotebook.lastOutput?.find(i => i.iteration === iteration - 1) ?? null;
                const forwardInfo = lastIteration?.forwardInfo ?? null;
                const allPreviousOutput = (turnNotebook.lastOutput ?? []).filter(i => i.iteration < iteration).flatMap(i => i.output ?? []);
                const lastIterationOutput = allPreviousOutput.length > 0 ? allPreviousOutput : null;
                const sessionMetadataValue = currentSession.sessionMetadata?.conversation;

                if(forwardInfo)
                {
                    conversation.push({
                        role: "user",
                        content: `forwardInfo: ${forwardInfo}`
                    });
                }

                if(sessionMetadataValue !== null && sessionMetadataValue !== undefined && sessionMetadataValue !== "")
                {
                    conversation.push({
                        role: "user",
                        content: `sessionMetadata: ${JSON.stringify(sessionMetadataValue)}`
                    });
                }

                if(lastIterationOutput && lastIterationOutput.length > 0)
                {
                    conversation.push({
                        role: "user",
                        content: `Output: ${JSON.stringify(lastIterationOutput)}`
                    });
                }

                conversation.push({
                    role: "user",
                    content: `Iteration: ${iteration}`
                });
            }

            if(signal?.aborted)
            {
                return null;
            }

            const filePaths = currentFiles.filter(f => !f.transcript && f.storagePath).map(f => f.storagePath);
            const aiResult = await manager.executeAI(phone, conversation, filePaths, signal, platform);

            if(aiResult.aborted)
            {
                return null;
            }

            if(aiResult.error || !aiResult.output)
            {
                if(isWhatsapp)
                {
                    await manager.whatsapp.sendError(
                        phone, 
                        "Failed to get AI response.", 
                        null
                    );
                }
                else
                {
                    await manager.socket.forward(
                        phone,
                        "onError",
                        {
                            statusCode: 500,
                            success: false,
                            message: "Failed to get AI response.",
                            data: null
                        },
                        false,
                        true
                    );
                }

                return null;
            }

            const output = aiResult.output;
            const forwardTo = output.instruction?.forwardTo ?? null;
            const forwardInfo = output.instruction?.forwardInfo ?? null;
            const instructions = output.instruction?.instructions ?? [];
            const aiMetadata = output.metadata ?? null;

            if(signal?.aborted)
            {
                return null;
            }

            const hasFileCommand = instructions.some(i => manager.fileCommands.has(i.command));
            if(hasFileCommand)
            {
                const fileSession = await manager.session.getSession(phone);
                if(fileSession)
                {
                    fileSession.fileInProgress = true;
                    await manager.session.updateSession(phone, fileSession);
                }
            }

            await manager.emitProcessing(phone, platform, true);

            let instructionResult = null;
            if(instructions.length > 0 && (forwardTo === null || forwardTo === "conversation"))
            {
                instructionResult = await manager.executeInstructions(phone, instructions, aiMetadata, forwardInfo);
            }

            const sessionAfterInstructions = await manager.session.getSession(phone);
            if(!sessionAfterInstructions)
            {
                return null;
            }

            if(!sessionAfterInstructions.turnNotebook || typeof sessionAfterInstructions.turnNotebook !== "object")
            {
                sessionAfterInstructions.turnNotebook = { costs: [], lastOutput: [] };
            }

            if(!Array.isArray(sessionAfterInstructions.turnNotebook.lastOutput))
            {
                sessionAfterInstructions.turnNotebook.lastOutput = [];
            }

            if(instructions.length === 0)
            {
                sessionAfterInstructions.turnNotebook.lastOutput.push({
                    iteration: iteration,
                    rawMetadata: aiMetadata ?? null,
                    jobs: null,
                    jobIds: null,
                    files: null,
                    output: [],
                    forwardInfo: forwardInfo ?? null
                });

                await manager.session.updateSession(phone, sessionAfterInstructions);
            }

            if(signal?.aborted)
            {
                return null;
            }

            if(!forwardTo || forwardTo === "revert" || forwardTo === "abort")
            {
                const finalSession = await manager.session.getSession(phone);
                if(!finalSession)
                {
                    return null;
                }

                finalSession.iteration = 1;

                const finalNotebook = finalSession.turnNotebook ?? {};
                const allLastOutput = finalNotebook.lastOutput ?? [];
                const costs = finalNotebook.costs ?? [];

                const combinedJobIds = [];
                const combinedJobs = [];
                const combinedFiles = [];
                const combinedRawMetadata = {};
                const seenIds = new Set();
                const seenFileNames = new Set();

                for(const iter of allLastOutput)
                {
                    if(iter.rawMetadata && typeof iter.rawMetadata === "object")
                    {
                        for(const [key, value] of Object.entries(iter.rawMetadata))
                        {
                            combinedRawMetadata[key] = value;
                        }
                    }

                    if(iter.jobs && Array.isArray(iter.jobs))
                    {
                        for(const job of iter.jobs)
                        {
                            if(!seenIds.has(job.id))
                            {
                                seenIds.add(job.id);
                                combinedJobs.push(job);
                            }
                        }
                    }

                    if(iter.jobIds && Array.isArray(iter.jobIds))
                    {
                        for(const jobId of iter.jobIds)
                        {
                            combinedJobIds.push(jobId);
                        }
                    }

                    if(iter.files && Array.isArray(iter.files))
                    {
                        for(const file of iter.files)
                        {
                            if(!seenFileNames.has(file.fileName))
                            {
                                seenFileNames.add(file.fileName);
                                combinedFiles.push(file);
                            }
                        }
                    }
                }

                const promptCosts = {
                    entries: costs,
                    total: costs.reduce((sum, c) => sum + (c.totalCost ?? 0), 0)
                };

                const dbMetadata = Object.keys(combinedRawMetadata).length > 0 ? combinedRawMetadata : null;

                const dbInstructionData = allLastOutput.flatMap(iter =>
                {
                    return (iter.output ?? []).map(entry =>
                    {
                        return {
                            command: entry.command,
                            instructionData: entry.instructionData ?? null,
                            success: entry.success,
                            message: entry.message
                        };
                    });
                });

                const payload = {
                    role: "assistant",
                    processing: false,
                    content: output.content ?? "",
                    cleanContent: output.cleanContent ?? null,
                    cleanUserContent: output.cleanUserContent ?? null,
                    options: output.options ?? null,
                    urls: output.urls ?? null,
                    insight: output.insight ?? null
                };

                const payloadMetadata = {};
                for(const [key, value] of Object.entries(combinedRawMetadata))
                {
                    payloadMetadata[key] = value;
                }

                if(combinedJobs.length > 0)
                {
                    payloadMetadata.jobs = combinedJobs;
                }

                if(combinedFiles.length > 0)
                {
                    payloadMetadata.files = combinedFiles;
                }

                if(Object.keys(payloadMetadata).length > 0)
                {
                    payload.metadata = payloadMetadata;
                }

                if(combinedJobIds.length > 0)
                {
                    payload.jobIds = combinedJobIds;
                }

                finalSession.turnNotebook.content = output.content ?? "";
                finalSession.turnNotebook.cleanContent = output.cleanContent ?? null;
                finalSession.turnNotebook.cleanUserContent = finalNotebook.cleanUserContent ?? output.cleanUserContent ?? null;
                finalSession.turnNotebook.urls = output.urls ?? null;
                finalSession.turnNotebook.combinedJobIds = combinedJobIds;
                finalSession.turnNotebook.combinedJobs = combinedJobs;
                finalSession.turnNotebook.combinedFiles = combinedFiles;
                finalSession.turnNotebook.combinedRawMetadata = combinedRawMetadata;
                finalSession.turnNotebook.dbInstructionData = dbInstructionData;
                finalSession.turnNotebook.promptCosts = promptCosts;
                finalSession.turnNotebook.dbMetadata = dbMetadata;
                finalSession.turnNotebook.completed = true;
                await manager.session.updateSession(phone, finalSession);

                if(isWhatsapp)
                {
                    await manager.whatsapp.sendMessage(phone, payload);
                    await manager.socket.forward(
                        phone, 
                        "onWhatsappMessage", 
                        payload, 
                        false, 
                        true
                    );

                    const terminalSessionWa = await manager.session.getSession(phone);
                    if(terminalSessionWa)
                    {
                        terminalSessionWa.fileInProgress = false;
                        await manager.session.updateSession(phone, terminalSessionWa);
                    }

                    await manager.emitProcessing(phone, platform, false);
                }
                else
                {
                    await manager.socket.forward(
                        phone, 
                        "onMessage", 
                        payload, 
                        false, 
                        true
                    );

                    const terminalSessionApp = await manager.session.getSession(phone);
                    if(terminalSessionApp)
                    {
                        terminalSessionApp.fileInProgress = false;
                        await manager.session.updateSession(phone, terminalSessionApp);
                    }

                    await manager.emitProcessing(phone, platform, false);
                }

                return null;
            }

            return await manager.recurse(manager, phone, platform, session, body, signal, forwardTo ?? "conversation");
        }
        catch(error)
        {
            console.error("conversation.resolve failed:", error);

            if(platform === "Whatsapp")
            {
                await manager.whatsapp.sendError(
                    phone, 
                    "Internal error.", 
                    null
                );
            }
            else
            {
                await manager.socket.forward(
                    phone,
                    "onError",
                    {
                        statusCode: 500,
                        success: false,
                        message: "Internal error.",
                        data: null
                    },
                    false,
                    true
                );
            }

            return null;
        }
    }

    async eligibilityHandler(manager, iteration, phone, platform, session, body, signal)
    {
        try
        {
            if(signal?.aborted)
            {
                return null;
            }

            const isWhatsapp = platform === "Whatsapp";
            let conversation = [];

            const candidateResult = await manager.retrieve.fetchCandidate(phone);
            const candidateData = candidateResult.success ? candidateResult.data : session.user;

            if(candidateData)
            {
                conversation.push({
                    role: "user",
                    content: `Output: ${JSON.stringify([{
                        command: "fetch-candidate",
                        instructionData: null,
                        statusCode: 200,
                        success: true,
                        message: "Candidate fetched successfully.",
                        data: candidateData
                    }])}`
                });
            }

            const jobIds = body.jobIds ?? [];
            if(jobIds.length > 0)
            {
                const jobResult = await manager.retrieve.fetchJobs(jobIds, phone);

                if(jobResult.success && Array.isArray(jobResult.data?.jobs) && jobResult.data.jobs.length > 0)
                {
                    conversation.push({
                        role: "user",
                        content: `Output: ${JSON.stringify([{
                            command: "fetch-jobs",
                            instructionData: { jobIds },
                            statusCode: 200,
                            success: true,
                            message: "Jobs fetched successfully.",
                            data: { jobs: jobResult.data.jobs }
                        }])}`
                    });
                }
            }

            const currentSession = await manager.session.getSession(phone);
            if(!currentSession)
            {
                return null;
            }

            const turnNotebook = currentSession.turnNotebook ?? {};
            const lastIteration = turnNotebook.lastOutput?.find(i => i.iteration === iteration - 1) ?? null;
            const forwardInfo = lastIteration?.forwardInfo ?? null;

            if(forwardInfo)
            {
                conversation.push({
                    role: "user",
                    content: `forwardInfo: ${forwardInfo}`
                });
            }

            const insights = await manager.AI.prompts.getInsights(phone);
            if(insights)
            {
                conversation.push({
                    role: "user",
                    content: `Candidate Insights: ${insights}`
                });
            }

            if(iteration === 1)
            {
                const currentContent = body.content ?? "";
                const currentJobIds = body.jobIds ?? null;

                const { formatted } = await manager.getRecentMessages(
                    phone,
                    platform,
                    session,
                    currentContent,
                    [],
                    currentJobIds
                );

                conversation.push(...formatted);

                const contextParts = {};
                if(body.metadata && Object.keys(body.metadata).length > 0)
                {
                    contextParts.metadata = body.metadata;
                }

                if(currentJobIds && currentJobIds.length > 0)
                {
                    contextParts.jobIds = currentJobIds;
                }

                const currentMessageParts = [];
                if(currentContent && currentContent.trim().length > 0)
                {
                    currentMessageParts.push(`Message: ${currentContent}`);
                }

                if(Object.keys(contextParts).length > 0)
                {
                    currentMessageParts.push(`Metadata: ${JSON.stringify(contextParts)}`);
                }

                currentMessageParts.push(`Iteration: ${iteration}`);
                conversation.push({
                    role: "user",
                    content: currentMessageParts.join("\n")
                });
            }
            else
            {
                conversation.push({
                    role: "user",
                    content: `Iteration: ${iteration}`
                });
            }

            if(signal?.aborted)
            {
                return null;
            }

            const sessionBeforeAI = await manager.session.getSession(phone);
            if(sessionBeforeAI && sessionBeforeAI.activePrompt !== "eligibility")
            {
                sessionBeforeAI.activePrompt = "eligibility";
                await manager.session.updateSession(phone, sessionBeforeAI);
            }

            const aiResult = await manager.executeAI(phone, conversation, [], signal, platform);
            if(aiResult.aborted)
            {
                return null;
            }

            if(aiResult.error || !aiResult.output)
            {
                if(isWhatsapp)
                {
                    await manager.whatsapp.sendError(
                        phone, 
                        "Failed to get AI response.", 
                        null
                    );
                }
                else
                {
                    await manager.socket.forward(
                        phone, 
                        "onError", 
                        { 
                            statusCode: 500, 
                            success: false, 
                            message: "Failed to get AI response.", 
                            data: null 
                        }, 
                        false, 
                        true
                    );
                }

                return null;
            }

            const output = aiResult.output;
            const forwardTo = output.instruction?.forwardTo ?? null;
            const nextForwardInfo = output.instruction?.forwardInfo ?? null;
            const aiMetadata = output.metadata ?? null;

            const sessionAfterAI = await manager.session.getSession(phone);
            if(!sessionAfterAI)
            {
                return null;
            }

            if(!sessionAfterAI.turnNotebook || typeof sessionAfterAI.turnNotebook !== "object")
            {
                sessionAfterAI.turnNotebook = { costs: [], lastOutput: [] };
            }

            if(!Array.isArray(sessionAfterAI.turnNotebook.lastOutput))
            {
                sessionAfterAI.turnNotebook.lastOutput = [];
            }

            sessionAfterAI.turnNotebook.lastOutput.push({
                iteration: iteration,
                rawMetadata: aiMetadata ?? null,
                jobs: null,
                jobIds: null,
                files: null,
                output: [],
                forwardInfo: nextForwardInfo ?? null
            });

            await manager.session.updateSession(phone, sessionAfterAI);
            if(signal?.aborted)
            {
                return null;
            }

            if(!forwardTo || forwardTo === "revert" || forwardTo === "abort" || forwardTo === "conversation")
            {
                const finalSession = await manager.session.getSession(phone);
                if(!finalSession)
                {
                    return null;
                }

                finalSession.iteration = 1;

                const finalNotebook = finalSession.turnNotebook ?? {};
                const costs = finalNotebook.costs ?? [];
                const combinedRawMetadata = {};

                for(const iter of finalNotebook.lastOutput ?? [])
                {
                    if(iter.rawMetadata && typeof iter.rawMetadata === "object")
                    {
                        for(const [key, value] of Object.entries(iter.rawMetadata))
                        {
                            combinedRawMetadata[key] = value;
                        }
                    }
                }

                const promptCosts = {
                    entries: costs,
                    total: costs.reduce((sum, c) => sum + (c.totalCost ?? 0), 0)
                };

                const dbMetadata = Object.keys(combinedRawMetadata).length > 0 ? combinedRawMetadata : null;

                const payload = {
                    role: "assistant",
                    processing: false,
                    content: output.content ?? "",
                    cleanContent: output.cleanContent ?? null,
                    cleanUserContent: output.cleanUserContent ?? null,
                    options: output.options ?? null,
                    urls: null,
                    insight: output.insight ?? null
                };

                if(aiMetadata && typeof aiMetadata === "object" && Object.keys(aiMetadata).length > 0)
                {
                    payload.metadata = aiMetadata;
                }

                finalSession.turnNotebook.content = output.content ?? "";
                finalSession.turnNotebook.cleanContent = output.cleanContent ?? null;
                finalSession.turnNotebook.cleanUserContent = finalNotebook.cleanUserContent ?? output.cleanUserContent ?? null;
                finalSession.turnNotebook.urls = null;
                finalSession.turnNotebook.combinedJobIds = [];
                finalSession.turnNotebook.combinedJobs = [];
                finalSession.turnNotebook.combinedFiles = [];
                finalSession.turnNotebook.combinedRawMetadata = combinedRawMetadata;
                finalSession.turnNotebook.dbInstructionData = [];
                finalSession.turnNotebook.promptCosts = promptCosts;
                finalSession.turnNotebook.dbMetadata = dbMetadata;
                finalSession.turnNotebook.completed = true;
                await manager.session.updateSession(phone, finalSession);

                if(isWhatsapp)
                {
                    await manager.whatsapp.sendMessage(
                        phone, 
                        payload
                    );

                    await manager.socket.forward(
                        phone, 
                        "onWhatsappMessage", 
                        payload, 
                        false, 
                        true
                    );

                    const terminalSessionWa = await manager.session.getSession(phone);
                    if(terminalSessionWa) 
                    { 
                        terminalSessionWa.fileInProgress = false; 
                        await manager.session.updateSession(phone, terminalSessionWa);
                    }

                    await manager.emitProcessing(phone, platform, false);
                }
                else
                {
                    await manager.socket.forward(
                        phone, 
                        "onMessage", 
                        payload, 
                        false, 
                        true
                    );

                    const terminalSessionApp = await manager.session.getSession(phone);
                    if(terminalSessionApp) 
                    { 
                        terminalSessionApp.fileInProgress = false; 
                        await manager.session.updateSession(phone, terminalSessionApp); 
                    }

                    await manager.emitProcessing(phone, platform, false);
                }

                return null;
            }

            return await manager.recurse(manager, phone, platform, session, body, signal, forwardTo ?? "conversation");
        }
        catch(error)
        {
            console.error("eligibilityHandler failed:", error);

            if(platform === "Whatsapp")
            {
                await manager.whatsapp.sendError(
                    phone, 
                    "Internal error.", 
                    null
                );
            }
            else
            {
                await manager.socket.forward(
                    phone, 
                    "onError", 
                    { 
                        statusCode: 500, 
                        success: false, 
                        message: "Internal error.", 
                        data: null 
                    }, 
                    false, 
                    true
                );
            }

            return null;
        }
    }

    async profileHandler(manager, iteration, phone, platform, session, body, signal)
    {
        return;
    }

    async examinerHandler(manager, iteration, phone, platform, session, body, signal)
    {
        return;
    }

    async screeningHandler(manager, iteration, phone, platform, session, body, signal)
    {
        return;
    }

    async resumeHandler(manager, iteration, phone, platform, session, body, signal)
    {
        try
        {
            if(signal?.aborted)
            {
                return null;
            }

            const isWhatsapp = platform === "Whatsapp";
            let conversation = [];
            let currentFiles = [];

            const candidateResult = await manager.retrieve.fetchCandidate(phone);
            const candidateData = candidateResult.success ? candidateResult.data : session.user;

            if(candidateData)
            {
                conversation.push({
                    role: "user",
                    content: `Output: ${JSON.stringify([{
                        command: "fetch-candidate",
                        instructionData: null,
                        statusCode: 200,
                        success: true,
                        message: "Candidate fetched successfully.",
                        data: candidateData
                    }])}`
                });
            }

            const currentSession = await manager.session.getSession(phone);
            if(!currentSession)
            {
                return null;
            }

            const turnNotebook = currentSession.turnNotebook ?? {};
            const lastIteration = turnNotebook.lastOutput?.find(i => i.iteration === iteration - 1) ?? null;
            const forwardInfo = lastIteration?.forwardInfo ?? null;
            const lastIterationOutput = lastIteration?.output ?? null;
            const sessionMetadataValue = currentSession.sessionMetadata?.resume;

            if(forwardInfo)
            {
                conversation.push({
                    role: "user",
                    content: `forwardInfo: ${forwardInfo}`
                });
            }

            if(sessionMetadataValue !== null && sessionMetadataValue !== undefined && sessionMetadataValue !== "")
            {
                conversation.push({
                    role: "user",
                    content: `sessionMetadata: ${JSON.stringify(sessionMetadataValue)}`
                });
            }

            if(lastIterationOutput && lastIterationOutput.length > 0)
            {
                conversation.push({
                    role: "user",
                    content: `Output: ${JSON.stringify(lastIterationOutput)}`
                });
            }

            if(iteration === 1)
            {
                const currentContent = body.content ?? "";
                const currentJobIds = body.jobIds ?? null;
                currentFiles = body.files ?? [];

                const { formatted } = await manager.getRecentMessages(
                    phone,
                    platform,
                    session,
                    currentContent,
                    currentFiles,
                    currentJobIds
                );

                if(currentFiles.length > 0 && !signal?.aborted)
                {
                    const fileResult = await manager.retrieve.fetchFileData(currentFiles);
                    if(fileResult.success)
                    {
                        currentFiles = fileResult.data.files;
                    }
                }

                if(signal?.aborted)
                {
                    return null;
                }

                conversation.push(...formatted);

                const contextParts = {};

                if(body.metadata && Object.keys(body.metadata).length > 0)
                {
                    contextParts.metadata = body.metadata;
                }

                if(currentJobIds && currentJobIds.length > 0)
                {
                    contextParts.jobIds = currentJobIds;
                }

                const filesWithTranscript = currentFiles.filter(f => f.transcript !== null && f.transcript !== undefined);
                if(filesWithTranscript.length > 0)
                {
                    contextParts.files = filesWithTranscript;
                }

                const currentMessageParts = [];

                if(currentContent && currentContent.trim().length > 0)
                {
                    currentMessageParts.push(`Message: ${currentContent}`);
                }

                if(Object.keys(contextParts).length > 0)
                {
                    currentMessageParts.push(`Metadata: ${JSON.stringify(contextParts)}`);
                }

                currentMessageParts.push(`Iteration: ${iteration}`);

                conversation.push({
                    role: "user",
                    content: currentMessageParts.join("\n")
                });
            }
            else
            {
                conversation.push({
                    role: "user",
                    content: `Iteration: ${iteration}`
                });
            }

            if(signal?.aborted)
            {
                return null;
            }

            const sessionBeforeAI = await manager.session.getSession(phone);
            if(sessionBeforeAI && sessionBeforeAI.activePrompt !== "resume")
            {
                sessionBeforeAI.activePrompt = "resume";
                await manager.session.updateSession(phone, sessionBeforeAI);
            }

            const filePaths = currentFiles.filter(f => !f.transcript && f.storagePath).map(f => f.storagePath);
            const aiResult = await manager.executeAI(phone, conversation, filePaths, signal, platform);

            if(aiResult.aborted)
            {
                return null;
            }

            if(aiResult.error || !aiResult.output)
            {
                if(isWhatsapp)
                {
                    await manager.whatsapp.sendError(phone, "Failed to get AI response.", null);
                }
                else
                {
                    await manager.socket.forward(
                        phone,
                        "onError",
                        {
                            statusCode: 500,
                            success: false,
                            message: "Failed to get AI response.",
                            data: null
                        },
                        false,
                        true
                    );
                }

                return null;
            }

            const output = aiResult.output;
            const forwardTo = output.instruction?.forwardTo ?? null;
            const nextForwardInfo = output.instruction?.forwardInfo ?? null;
            const instructions = output.instruction?.instructions ?? [];
            const aiMetadata = output.metadata ?? null;

            if(signal?.aborted)
            {
                return null;
            }

            const hasFileCommand = instructions.some(i => manager.fileCommands.has(i.command));
            if(hasFileCommand)
            {
                const fileSession = await manager.session.getSession(phone);
                if(fileSession)
                {
                    fileSession.fileInProgress = true;
                    await manager.session.updateSession(phone, fileSession);
                }
            }

            await manager.emitProcessing(phone, platform, true);

            const createResumeInstruction = instructions.find(i => i.command === "create-resume") ?? null;
            const sessionAfterAI = await manager.session.getSession(phone);
            if(!sessionAfterAI)
            {
                return null;
            }

            if(!sessionAfterAI.turnNotebook || typeof sessionAfterAI.turnNotebook !== "object")
            {
                sessionAfterAI.turnNotebook = { costs: [], lastOutput: [] };
            }

            if(!Array.isArray(sessionAfterAI.turnNotebook.lastOutput))
            {
                sessionAfterAI.turnNotebook.lastOutput = [];
            }

            if(!createResumeInstruction)
            {
                sessionAfterAI.turnNotebook.lastOutput.push({
                    iteration: iteration,
                    rawMetadata: aiMetadata ?? null,
                    jobs: null,
                    jobIds: null,
                    files: null,
                    output: [],
                    forwardInfo: nextForwardInfo ?? null
                });

                await manager.session.updateSession(phone, sessionAfterAI);
            }
            else
            {
                const resumeData = createResumeInstruction.instructionData?.resume ?? {};
                const createResult = await manager.perform.createResume(phone, resumeData);

                const outputEntry =
                {
                    command: "create-resume",
                    instructionData: createResumeInstruction.instructionData ?? null,
                    statusCode: createResult.statusCode,
                    success: createResult.success,
                    message: createResult.message,
                    data: createResult.data ?? null
                };

                const resultFiles = createResult.data?.files ?? [];
                const iterationFiles = resultFiles.map(f => ({
                    fileName: f.fileName,
                    fileSize: f.fileSize,
                    fileType: f.fileType,
                    filePath: f.filePath,
                    saved: f.saved ?? false
                }));

                sessionAfterAI.turnNotebook.lastOutput.push({
                    iteration: iteration,
                    rawMetadata: aiMetadata ?? null,
                    jobs: null,
                    jobIds: null,
                    files: iterationFiles.length > 0 ? iterationFiles : null,
                    output: [outputEntry],
                    forwardInfo: nextForwardInfo ?? null
                });

                const existingSessionLastOutput = Array.isArray(sessionAfterAI.lastOutput) ? sessionAfterAI.lastOutput : [];
                existingSessionLastOutput.push(outputEntry);
                sessionAfterAI.lastOutput = existingSessionLastOutput;

                await manager.session.updateSession(phone, sessionAfterAI);
            }

            if(signal?.aborted)
            {
                return null;
            }

            if(!forwardTo || forwardTo === "revert" || forwardTo === "abort" || forwardTo === "profile")
            {
                const finalSession = await manager.session.getSession(phone);
                if(!finalSession)
                {
                    return null;
                }

                finalSession.iteration = 1;

                const finalNotebook = finalSession.turnNotebook ?? {};
                const allLastOutput = finalNotebook.lastOutput ?? [];
                const costs = finalNotebook.costs ?? [];

                const combinedFiles = [];
                const combinedRawMetadata = {};
                const seenFileNames = new Set();

                for(const iter of allLastOutput)
                {
                    if(iter.rawMetadata && typeof iter.rawMetadata === "object")
                    {
                        for(const [key, value] of Object.entries(iter.rawMetadata))
                        {
                            combinedRawMetadata[key] = value;
                        }
                    }

                    if(iter.files && Array.isArray(iter.files))
                    {
                        for(const file of iter.files)
                        {
                            if(!seenFileNames.has(file.fileName))
                            {
                                seenFileNames.add(file.fileName);
                                combinedFiles.push(file);
                            }
                        }
                    }
                }

                const promptCosts =
                {
                    entries: costs,
                    total: costs.reduce((sum, c) => sum + (c.totalCost ?? 0), 0)
                };

                const dbMetadata = Object.keys(combinedRawMetadata).length > 0 ? combinedRawMetadata : null;

                const dbInstructionData = allLastOutput.flatMap(iter =>
                {
                    return (iter.output ?? []).map(entry =>
                    {
                        return {
                            command: entry.command,
                            instructionData: entry.instructionData ?? null,
                            success: entry.success,
                            message: entry.message
                        };
                    });
                });

                const payload =
                {
                    role: "assistant",
                    processing: false,
                    content: output.content ?? "",
                    cleanContent: output.cleanContent ?? null,
                    cleanUserContent: output.cleanUserContent ?? null,
                    options: output.options ?? null,
                    urls: output.urls ?? null,
                    insight: output.insight ?? null
                };

                const payloadMetadata = {};

                for(const [key, value] of Object.entries(combinedRawMetadata))
                {
                    payloadMetadata[key] = value;
                }

                if(combinedFiles.length > 0)
                {
                    payloadMetadata.files = combinedFiles;
                }

                if(Object.keys(payloadMetadata).length > 0)
                {
                    payload.metadata = payloadMetadata;
                }

                finalSession.turnNotebook.content = output.content ?? "";
                finalSession.turnNotebook.cleanContent = output.cleanContent ?? null;
                finalSession.turnNotebook.cleanUserContent = finalNotebook.cleanUserContent ?? output.cleanUserContent ?? null;
                finalSession.turnNotebook.urls = output.urls ?? null;
                finalSession.turnNotebook.combinedJobIds = [];
                finalSession.turnNotebook.combinedJobs = [];
                finalSession.turnNotebook.combinedFiles = combinedFiles;
                finalSession.turnNotebook.combinedRawMetadata = combinedRawMetadata;
                finalSession.turnNotebook.dbInstructionData = dbInstructionData;
                finalSession.turnNotebook.promptCosts = promptCosts;
                finalSession.turnNotebook.dbMetadata = dbMetadata;
                finalSession.turnNotebook.completed = true;
                await manager.session.updateSession(phone, finalSession);

                if(isWhatsapp)
                {
                    await manager.whatsapp.sendMessage(phone, payload);

                    await manager.socket.forward(
                        phone, 
                        "onWhatsappMessage", 
                        payload, 
                        false, 
                        true
                    );

                    const terminalSessionWa = await manager.session.getSession(phone);
                    if(terminalSessionWa)
                    {
                        terminalSessionWa.fileInProgress = false;
                        await manager.session.updateSession(phone, terminalSessionWa);
                    }

                    await manager.emitProcessing(phone, platform, false);
                }
                else
                {
                    await manager.socket.forward(
                        phone, 
                        "onMessage", 
                        payload, 
                        false, 
                        true
                    );

                    const terminalSessionApp = await manager.session.getSession(phone);
                    if(terminalSessionApp)
                    {
                        terminalSessionApp.fileInProgress = false;
                        await manager.session.updateSession(phone, terminalSessionApp);
                    }

                    await manager.emitProcessing(phone, platform, false);
                }

                return null;
            }

            return await manager.recurse(manager, phone, platform, session, body, signal, forwardTo ?? "conversation");
        }
        catch(error)
        {
            console.error("resumeHandler failed:", error);

            if(platform === "Whatsapp")
            {
                await manager.whatsapp.sendError(phone, "Internal error.", null);
            }
            else
            {
                await manager.socket.forward(
                    phone,
                    "onError",
                    {
                        statusCode: 500,
                        success: false,
                        message: "Internal error.",
                        data: null
                    },
                    false,
                    true
                );
            }

            return null;
        }
    }

    async recurse(manager, phone, platform, session, body, signal, forwardTo)
    {
        const specialist = manager.specialists[forwardTo ?? "conversation"];

        if(!specialist)
        {
            console.error(`❌ recurse: no specialist found for forwardTo: ${forwardTo}`);
            return null;
        }

        const currentSession = await manager.session.getSession(phone);
        if(!currentSession)
        {
            return null;
        }

        const nextIteration = (currentSession.iteration ?? 1) + 1;
        currentSession.activePrompt = forwardTo ?? "conversation";
        currentSession.iteration = nextIteration;
        await manager.session.updateSession(phone, currentSession);

        console.log(`🔀 recurse: forwardTo=${currentSession.activePrompt}, iteration=${nextIteration}`);

        return await specialist.resolve(
            manager,
            nextIteration,
            phone,
            platform,
            currentSession,
            body,
            signal
        );
    }

    async finallyHandler(phone, platform, body, signal)
    {
        try
        {
            const currentSession = await this.session.getSession(phone);
            if(!currentSession)
            {
                return;
            }

            const notebook = currentSession.turnNotebook ?? {};
            const costs = notebook.costs ?? [];
            const allLastOutput = notebook.lastOutput ?? [];
            const completed = notebook.completed === true;
            const cancelled = !completed;

            const combinedJobIds = [];
            const combinedJobs = [];
            const combinedFiles = [];
            const combinedRawMetadata = {};
            const dbInstructionData = [];

            const seenJobIds = new Set();
            const seenJobIdsFull = new Set();
            const seenFileNames = new Set();

            for(const iter of allLastOutput)
            {
                if(iter.rawMetadata && typeof iter.rawMetadata === "object")
                {
                    for(const [key, value] of Object.entries(iter.rawMetadata))
                    {
                        combinedRawMetadata[key] = value;
                    }
                }

                if(iter.jobs && Array.isArray(iter.jobs))
                {
                    for(const j of iter.jobs)
                    {
                        if(!seenJobIds.has(j.id))
                        {
                            seenJobIds.add(j.id);
                            combinedJobs.push(j);
                        }
                    }
                }

                if(iter.jobIds && Array.isArray(iter.jobIds))
                {
                    for(const j of iter.jobIds)
                    {
                        if(!seenJobIdsFull.has(j.id))
                        {
                            seenJobIdsFull.add(j.id);
                            combinedJobIds.push(j);
                        }
                    }
                }

                if(iter.files && Array.isArray(iter.files))
                {
                    for(const f of iter.files)
                    {
                        if(!seenFileNames.has(f.fileName))
                        {
                            seenFileNames.add(f.fileName);
                            combinedFiles.push(f);
                        }
                    }
                }

                for(const entry of (iter.output ?? []))
                {
                    dbInstructionData.push({
                        command: entry.command,
                        instructionData: entry.instructionData ?? null,
                        success: entry.success,
                        message: entry.message
                    });
                }
            }

            const promptCosts = costs.length > 0 ? {
                entries: costs,
                total: costs.reduce((sum, c) => sum + (c.totalCost ?? 0), 0)
            } : null;

            const dbMetadata = Object.keys(combinedRawMetadata).length > 0 ? combinedRawMetadata : null;

            await this.database.saveMessage(
                this.session,
                phone,
                platform,
                currentSession.webName ?? "White Force",
                {
                    role: "assistant",
                    content: notebook.content ?? "",
                    urls: notebook.urls ?? [],
                    jobIds: combinedJobIds,
                    files: combinedFiles,
                    instructionData: dbInstructionData.length > 0 ? dbInstructionData : null,
                    isServer: false,
                    metadata: dbMetadata,
                    promptCosts: promptCosts,
                    cancelled: cancelled,
                    cleanContent: notebook.cleanContent ?? null,
                    ...(platform === "Whatsapp" ? {
                        whatsappMessageId: notebook?.whatsappMessageId ?? null,
                        whatsappRawPayload: notebook?.whatsappRawPayload ?? null
                    } : {})
                }
            );

            if(notebook.cleanUserContent && body?._userMessageId)
            {
                if(platform === "Whatsapp")
                {
                    await this.database.db.updateWiraWhatsappMessages(
                        { 
                            cleanContent: notebook.cleanUserContent 
                        },
                        { 
                            id: body._userMessageId 
                        }
                    );
                }
                else
                {
                    await this.database.db.updateWiraAppMessages(
                        { 
                            cleanContent: notebook.cleanUserContent 
                        },
                        { 
                            id: body._userMessageId 
                        }
                    );
                }
            }

            const freshSession = await this.session.getSession(phone);
            if(!freshSession)
            {
                return;
            }

            if(platform === "Whatsapp")
            {
                freshSession.processing.whatsapp = false;
            }
            else
            {
                freshSession.processing.app = false;
            }

            freshSession.turnNotebook = null;
            freshSession.iteration = 1;
            freshSession.fileInProgress = false;

            await this.session.updateSession(phone, freshSession);
            await this.emitProcessing(phone, platform, false);
        }
        catch(error)
        {
            console.error("❌ finallyHandler failed:", error.message);
        }
    }

    async emitProcessing(phone, platform, processing)
    {
        const session = await this.session.getSession(phone);
        const file = session?.fileInProgress ?? false;
        const event = platform === "Whatsapp" ? "onWhatsappProcessing" : "onProcessing";

        await this.socket.forward(
            phone, 
            event, 
            { 
                processing, file 
            }, 
            false, 
            false
        );
    }
          
    async wishlist(socket, body, callback)
    {
        try
        {
            const phone = socket.handshake.auth.phone || socket.handshake.query.phone;
            const jobId = body?.jobId;
            const add = body?.wishlist;

            if(!jobId || typeof add !== "boolean")
            {
                return this.socket.handleCallBack(
                    callback, 
                    400, 
                    false, 
                    "Missing or invalid jobId or wishlist flag.", 
                    null
                );
            }

            const session = await this.session.getSession(phone);
            if(!session)
            {
                return this.socket.handleCallBack(
                    callback, 
                    401, 
                    false, 
                    "Session not found.", 
                    null
                );
            }

            const ids = session.wishlistIds ?? [];
            const idx = ids.indexOf(jobId);

            if(add && idx === -1)
            {
                ids.push(jobId);
            }

            else if(!add && idx !== -1)
            {
                ids.splice(idx, 1);
            }

            session.wishlistIds = ids;
            await this.session.updateSession(phone, session);

            return this.socket.handleCallBack(
                callback, 
                200, 
                true, 
                "Wishlist updated.", 
                null
            );
        }
        catch(error)
        {
            console.error("❌ wishlist failed:", error.message);

            return this.socket.handleCallBack(
                callback, 
                500, 
                false, 
                "Internal error.", 
                null
            );
        }
    }

    async applyJob(socket, body, callback)
    {
        try
        {
            const phone = socket.handshake.auth.phone || socket.handshake.query.phone;
            const jobId = body?.jobId;
            const add = body?.applied;

            if(!jobId || typeof add !== "boolean")
            {
                return this.socket.handleCallBack(
                    callback, 
                    400, 
                    false, 
                    "Missing or invalid jobId or applied flag.", 
                    null
                );
            }

            const session = await this.session.getSession(phone);
            if(!session)
            {
                return this.socket.handleCallBack(
                    callback, 
                    401, 
                    false, 
                    "Session not found.", 
                    null
                );
            }

            const ids = session.appliedJobIds ?? [];
            const idx = ids.indexOf(jobId);

            if(add && idx === -1)
            {
                ids.push(jobId);
            }

            else if(!add && idx !== -1)
            {
                ids.splice(idx, 1);
            }

            session.appliedJobIds = ids;
            await this.session.updateSession(phone, session);

            return this.socket.handleCallBack(
                callback, 
                200, 
                true, 
                "Applied jobs updated.", 
                null
            );
        }
        catch(error)
        {
            console.error("❌ applyJob failed:", error.message);

            return this.socket.handleCallBack(
                callback, 
                500, 
                false, 
                "Internal error.", 
                null
            );
        }
    }

    async disconnect(socket)
    {
        const phone = socket.handshake.auth.phone || socket.handshake.query.phone;
        await this.session.removeSocket(phone, socket.id);
    }
}

module.exports = WiraManager;