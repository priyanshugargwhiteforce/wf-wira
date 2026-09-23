class WiraUtility
{
    constructor(session)
    {
        this.session = session;
    }

    getWindowWelcomeMessage(webName)
    {
        const AIName = webName === "AstroBuddy" ? "Mira" : "Wira";

        return {
            role: "assistant",
            content: `Welcome to ${webName}. I'm ${AIName}, your assistant here to help you with your queries. How can I help you today?`,
            geminiCost: 0
        };
    }

    formatExperience(exp)
    {
        if(exp === null || exp === undefined || exp === "")
        {
            return null;
        }
        const [years, months] = String(exp).split(".").map(Number);
        return `${years} years ${months} months`;
    }

    formatLastOutputForAI(jobs, wishlistIds = [], appliedJobIds = [])
    {
        if(!jobs || !Array.isArray(jobs) || jobs.length === 0)
        {
            return null;
        }

        function formatStatus(status, pipelineData)
        {
            if(!status || status === "applied")
            {
                return "stage: Applied";
            }

            const stage = pipelineData?.stage?.toLowerCase();
            const stageLabels = {
                sourcing: "Shortlisted",
                telephonic: "Telephonic Interview",
                f2f: "Face to Face Interview",
                not_attend: "Interview Not Attended",
                rejected: "Not Shortlisted",
                selected: "Selected",
                offered: "Offer Letter Received",
                joined: "Joined",
                backout: "Backed Out"
            };

            const interviewStages = ["telephonic", "f2f", "not_attend", "rejected", "selected", "offered", "joined", "backout"];
            const parts = [`stage: ${stageLabels[stage] || stage}`];

            if(interviewStages.includes(stage))
            {
                const interviewType = pipelineData.interviewStage === "f2f" ? "Face to face interview" : pipelineData.interviewStage === "telephonic" ? "Telephonic interview" : stage === "f2f" ? "Face to face interview" : "Telephonic interview";
                parts.push(`stage type: ${interviewType}`);

                if(pipelineData.interviewDate)
                {
                    parts.push(`Interview Date: ${pipelineData.interviewDate}`);
                }

                if(pipelineData.interviewTimeFrom)
                {
                    parts.push(`Interview time from: ${pipelineData.interviewTimeFrom}`);
                }

                if(pipelineData.interviewTimeTo)
                {
                    parts.push(`Interview time to: ${pipelineData.interviewTimeTo}`);
                }

                if(pipelineData.interviewVenue)
                {
                    parts.push(`Interview venue: ${pipelineData.interviewVenue}`);
                }
            }

            if(stage === "joined" && pipelineData.joiningDate)
            {
                parts.push(`Joining Date: ${pipelineData.joiningDate}`);
            }

            return parts.join(" | ");
        }

        return jobs.map((item) =>
        {
            const summary = { id: item.id };

            if(item.clientName !== undefined && item.clientName !== null) summary.clientName = item.clientName;
            if(item.positionName !== undefined && item.positionName !== null) summary.positionName = item.positionName;
            if(item.openings !== undefined && item.openings !== null) summary.openings = item.openings;

            const locParts = [];
            if(item.country !== undefined && item.country !== null) locParts.push(`Country: ${item.country}`);
            if(item.state !== undefined && item.state !== null) locParts.push(`State: ${item.state}`);
            if(item.city !== undefined && item.city !== null) locParts.push(`City: ${item.city}`);
            if(item.location !== undefined && item.location !== null) locParts.push(`Location: ${item.location}`);
            if(item.jobAddress !== undefined && item.jobAddress !== null) locParts.push(`Address: ${item.jobAddress}`);
            if(item.postalCode !== undefined && item.postalCode !== null) locParts.push(`Postal: ${item.postalCode}`);
            if(locParts.length > 0) summary.location = locParts.join(" | ");

            if(item.industry !== undefined && item.industry !== null) summary.industry = item.industry;
            if(item.gender !== undefined && item.gender !== null) summary.gender = item.gender;

            const salParts = [];
            if(item.salaryType !== undefined && item.salaryType !== null) salParts.push(`Type: ${item.salaryType}`);
            if(item.minSalary !== undefined && item.minSalary !== null) salParts.push(`Min: ${item.minSalary}`);
            if(item.maxSalary !== undefined && item.maxSalary !== null) salParts.push(`Max: ${item.maxSalary}`);
            if(salParts.length > 0) summary.salary = salParts.join(" | ");

            if(item.jobType !== undefined && item.jobType !== null) summary.jobType = item.jobType;
            if(Array.isArray(item.skillSet) && item.skillSet.length > 0) summary.skills = item.skillSet;

            const qualParts = [];
            if(item.minYearExp !== undefined && item.minYearExp !== null) qualParts.push(`Min exp: ${item.minYearExp}`);
            if(item.maxYearExp !== undefined && item.maxYearExp !== null) qualParts.push(`Max exp: ${item.maxYearExp}`);
            if(item.eduQualification !== undefined && item.eduQualification !== null) qualParts.push(`Education: ${item.eduQualification}`);
            if(Array.isArray(item.specification) && item.specification.length > 0) qualParts.push(`Spec: ${item.specification}`);
            if(qualParts.length > 0) summary.qualification = qualParts.join(" | ");

            if(wishlistIds.length > 0)
            {
                summary.isWishlisted = wishlistIds.includes(item.id);
            }

            if(appliedJobIds.length > 0)
            {
                summary.isApplied = appliedJobIds.includes(item.id);
            }

            if(item.similarity !== undefined && item.similarity !== null)
            {
                summary.similarity = item.similarity;
            }

            if(item.status !== undefined)
            {
                summary.status = formatStatus(item.status, item.pipelineData ?? null);
            }

            return summary;
        });
    }

    formatRouterMessage(role, content, files, jobIds)
    {
        const parts = [];

        if(content && content.trim().length > 0)
        {
            const stripped = content.trim().replace(/<(\w+)>[\s\S]*?<\/\1>/g, "<$1/>");
            parts.push(stripped);
        }

        if(files && Array.isArray(files) && files.length > 0)
        {
            const names = files.map(f => f.fileName).filter(Boolean);

            if(names.length > 0)
            {
                parts.push(`Files: ${names.join(", ")}`);
            }
        }

        if(role === "user")
        {
            if(jobIds && Array.isArray(jobIds) && jobIds.length > 0)
            {
                parts.push(`Selected Job IDs: ${jobIds.join(", ")}`);
            }
        }
        else if(role === "assistant")
        {
            if(jobIds && jobIds.data && Array.isArray(jobIds.data) && jobIds.data.length > 0)
            {
                const names = jobIds.data.map(j => `${j.id}: ${j.positionName}`).filter(j => j).join(", ");

                if(names.length > 0)
                {
                    parts.push(`Jobs showed: ${names}`);
                }
            }
        }

        const text = parts.join("\n");
        if(!text.length)
        {
            return null;
        }

        return {
            role: role,
            content: text
        };
    }

    formatMessageForConversation(role, data, suppressMetadataKeys = [])
    {
        const parts = [];

        if(role === "user")
        {
            if(data.content && data.content.trim().length > 0)
            {
                parts.push(`Message: ${data.content}`);
            }

            if(data.files && Array.isArray(data.files) && data.files.length > 0)
            {
                const names = data.files.map(f => f.fileName).filter(Boolean).join(", ");

                if(names.length > 0)
                {
                    parts.push(`Files: ${names}`);
                }
            }

            if(data.jobIds && Array.isArray(data.jobIds) && data.jobIds.length > 0)
            {
                parts.push(`Selected JobIds: ${data.jobIds.join(", ")}`);
            }

            if(data.metadata && Object.keys(data.metadata).length > 0)
            {
                parts.push(`Metadata: ${JSON.stringify(data.metadata)}`);
            }
        }

        else if(role === "assistant")
        {
            if(data.content && data.content.trim().length > 0)
            {
                const stripped = data.content.trim().replace(/<(\w+)>[\s\S]*?<\/\1>/g, "<$1/>");
                parts.push(stripped);
            }

            if(data.files && Array.isArray(data.files) && data.files.length > 0)
            {
                const names = data.files.map(f => f.fileName).filter(Boolean).join(", ");

                if(names.length > 0)
                {
                    parts.push(`Files: ${names}`);
                }
            }

            if(data.jobIds && data.jobIds.data && Array.isArray(data.jobIds.data) && data.jobIds.data.length > 0)
            {
                const jobs = data.jobIds.data.map(j => `${j.id}: ${j.positionName}`).filter(Boolean).join(", ");

                if(jobs.length > 0)
                {
                    parts.push(`Jobs shown: ${jobs}`);
                }
            }

            if(data.metadata && Object.keys(data.metadata).length > 0)
            {
                const filtered = Object.fromEntries(
                    Object.entries(data.metadata).filter(([key]) => !suppressMetadataKeys.includes(key))
                );

                if(Object.keys(filtered).length > 0)
                {
                    parts.push(`Metadata: ${JSON.stringify(filtered)}`);
                }
            }
        }

        if(parts.length === 0)
        {
            return null;
        }

        return {
            role: role,
            content: parts.join("\n")
        };
    }

    formatSemanticContext(source, data)
    {
        const parts = [];

        switch(source)
        {
            case "Call":
            {
                if(!data.summary || data.summary.trim().length === 0)
                {
                    return null;
                }

                parts.push(`[Past Call | Relevance: ${data.similarity}%]`);
                parts.push(`Summary: ${data.summary}`);
                break;
            }

            case "Artifact":
            {
                if(!data.content || data.content.trim().length === 0)
                {
                    return null;
                }

                parts.push(`[File: ${data.fileName ?? "unknown"} | Relevance: ${data.similarity}%]`);
                parts.push(`Content: ${data.content}`);
                break;
            }

            case "App":
            case "Web":
            case "Whatsapp":
            {
                parts.push(`[Past Message | Platform: ${source} | Relevance: ${data.similarity}%]`);

                if(data.content && data.content.trim().length > 0)
                {
                    parts.push(`Message: ${data.content}`);
                }

                if(data.files && Array.isArray(data.files) && data.files.length > 0)
                {
                    const names = data.files.map(f => f.fileName).filter(Boolean).join(", ");

                    if(names.length > 0)
                    {
                        parts.push(`Files: ${names}`);
                    }
                }

                if(data.jobIds && Array.isArray(data.jobIds) && data.jobIds.length > 0)
                {
                    parts.push(`Selected Jobs: ${data.jobIds.join(", ")}`);
                }

                break;
            }

            case "Business":
            {
                if(!data.section || data.section.trim().length === 0)
                {
                    return null;
                }

                parts.push(`[Business Info | Source: ${data.sourceUrl ?? "unknown"} | Relevance: ${data.similarity}%]`);

                if(data.title && data.title.trim().length > 0)
                {
                    parts.push(`Title: ${data.title}`);
                }

                parts.push(`Info: ${data.section}`);
                break;
            }

            default:
            {
                return null;
            }
        }

        if(parts.length === 0)
        {
            return null;
        }

        return parts.join("\n");
    }
}

module.exports = WiraUtility;